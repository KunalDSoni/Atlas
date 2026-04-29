#!/bin/bash
# ===== Atlas — Server Initial Setup Script =====
# Run this ONCE on a fresh Ubuntu server (22.04/24.04)
# Usage: ssh root@your-server 'bash -s' < scripts/server-setup.sh

set -euo pipefail

echo "═══════════════════════════════════════════"
echo "  Atlas — Server Setup"
echo "═══════════════════════════════════════════"

# ─── 1. System Updates ───
echo ""
echo "→ Updating system packages..."
apt-get update && apt-get upgrade -y

# ─── 2. Install Docker ───
echo ""
echo "→ Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "  ✓ Docker installed"
else
    echo "  ✓ Docker already installed"
fi

# ─── 3. Install Docker Compose (plugin) ───
echo ""
echo "→ Verifying Docker Compose..."
if docker compose version &>/dev/null; then
    echo "  ✓ Docker Compose available"
else
    apt-get install -y docker-compose-plugin
    echo "  ✓ Docker Compose installed"
fi

# ─── 4. Install Git ───
echo ""
echo "→ Checking Git..."
if ! command -v git &>/dev/null; then
    apt-get install -y git
    echo "  ✓ Git installed"
else
    echo "  ✓ Git already installed"
fi

# ─── 5. Create deploy user ───
echo ""
echo "→ Creating atlas user..."
if ! id atlas &>/dev/null; then
    useradd -m -s /bin/bash -G docker atlas
    mkdir -p /home/atlas/.ssh
    cp /root/.ssh/authorized_keys /home/atlas/.ssh/ 2>/dev/null || true
    chown -R atlas:atlas /home/atlas/.ssh
    chmod 700 /home/atlas/.ssh
    chmod 600 /home/atlas/.ssh/authorized_keys 2>/dev/null || true
    echo "  ✓ User 'atlas' created and added to docker group"
else
    usermod -aG docker atlas
    echo "  ✓ User 'atlas' already exists, ensured docker group membership"
fi

# ─── 6. Create app directory ───
echo ""
echo "→ Setting up /opt/atlas..."
mkdir -p /opt/atlas
chown atlas:atlas /opt/atlas

# ─── 7. Firewall ───
echo ""
echo "→ Configuring firewall..."
if command -v ufw &>/dev/null; then
    ufw allow OpenSSH
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
    echo "  ✓ Firewall configured (SSH + HTTP + HTTPS)"
fi

# ─── 8. Setup SSH key for GitHub Actions ───
echo ""
echo "→ Generating deploy SSH key..."
DEPLOY_KEY="/home/atlas/.ssh/id_ed25519"
if [ ! -f "$DEPLOY_KEY" ]; then
    su - atlas -c "ssh-keygen -t ed25519 -f $DEPLOY_KEY -N '' -C 'atlas-deploy'"
    echo ""
    echo "  ✓ Deploy key generated. Add this PUBLIC key to your server's authorized_keys:"
    echo ""
    cat "${DEPLOY_KEY}.pub"
    echo ""
    echo "  And add the PRIVATE key as a GitHub secret named SSH_PRIVATE_KEY:"
    echo ""
    cat "$DEPLOY_KEY"
    echo ""
fi

# ─── 9. Summary ───
echo ""
echo "═══════════════════════════════════════════"
echo "  ✓ Server setup complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "  Docker:    $(docker --version)"
echo "  Compose:   $(docker compose version)"
echo "  Git:       $(git --version)"
echo "  User:      atlas (in docker group)"
echo "  App dir:   /opt/atlas"
echo ""
echo "  Next steps:"
echo "  1. Clone your repo to /opt/atlas"
echo "  2. Copy .env.example to .env and configure"
echo "  3. Run: docker compose up -d"
echo ""
echo "  For GitHub Actions CI/CD, set these secrets:"
echo "    SERVER_HOST     = $(curl -s ifconfig.me 2>/dev/null || echo 'your-server-ip')"
echo "    SERVER_USER     = atlas"
echo "    SSH_PRIVATE_KEY = (the key printed above)"
echo "    REPO_URL        = git@github.com:YOUR_USER/atlas.git"
echo ""
