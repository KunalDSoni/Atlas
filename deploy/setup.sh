#!/bin/bash
# ===== ATLAS — Server Setup Script =====
# Run this on your server: sudo bash setup.sh
# Tested on: Ubuntu 20.04/22.04/24.04, Debian 11/12

set -e

echo "=========================================="
echo "  ATLAS — Automated Server Setup"
echo "=========================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}[STEP]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Must run as root
if [ "$EUID" -ne 0 ]; then
    err "Please run as root: sudo bash setup.sh"
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VER=$VERSION_ID
    echo "Detected OS: $PRETTY_NAME"
else
    err "Cannot detect OS. This script supports Ubuntu/Debian."
fi

# ===== 1. System updates & dependencies =====
step "Updating system packages..."
apt-get update -y && apt-get upgrade -y

step "Installing required packages..."
apt-get install -y curl git nginx ufw

# ===== 2. Install Node.js 20 LTS =====
step "Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo "Node.js $(node -v) installed"
else
    echo "Node.js $(node -v) already installed"
fi

# ===== 3. Create atlas user =====
step "Creating atlas system user..."
if ! id "atlas" &>/dev/null; then
    useradd --system --shell /bin/false --home /opt/atlas atlas
    echo "User 'atlas' created"
else
    echo "User 'atlas' already exists"
fi

# ===== 4. Deploy application =====
step "Deploying Atlas application..."
mkdir -p /opt/atlas

# Copy application files (assumes this script is run from the Atlas directory)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ATLAS_DIR="$(dirname "$SCRIPT_DIR")"

# Copy backend
cp -r "$ATLAS_DIR/backend" /opt/atlas/
# Copy frontend
cp -r "$ATLAS_DIR/frontend" /opt/atlas/

# Copy production .env
cp "$SCRIPT_DIR/.env.production" /opt/atlas/backend/.env

# Generate a random session secret
SESSION_SECRET=$(openssl rand -hex 32)
sed -i "s/CHANGE_ME_TO_A_RANDOM_64_CHAR_STRING/$SESSION_SECRET/" /opt/atlas/backend/.env
echo "Generated random session secret"

# Install dependencies
step "Installing Node.js dependencies..."
cd /opt/atlas/backend
npm install --production
cd -

# Create uploads directory
mkdir -p /opt/atlas/backend/uploads

# Set permissions
chown -R atlas:atlas /opt/atlas
chmod 755 /opt/atlas

# ===== 5. Setup systemd service =====
step "Setting up systemd service..."
cp "$SCRIPT_DIR/atlas.service" /etc/systemd/system/atlas.service
systemctl daemon-reload
systemctl enable atlas
systemctl start atlas

# Wait for app to start
sleep 3
if systemctl is-active --quiet atlas; then
    echo -e "${GREEN}Atlas service started successfully!${NC}"
else
    warn "Service may not have started. Check: journalctl -u atlas -f"
fi

# ===== 6. Setup Nginx =====
step "Configuring Nginx reverse proxy..."
cp "$SCRIPT_DIR/atlas.nginx.conf" /etc/nginx/sites-available/atlas

# Remove default site if it exists
rm -f /etc/nginx/sites-enabled/default

# Enable atlas site
ln -sf /etc/nginx/sites-available/atlas /etc/nginx/sites-enabled/atlas

# Test nginx config
nginx -t
systemctl restart nginx
systemctl enable nginx
echo "Nginx configured and running"

# ===== 7. Configure firewall =====
step "Configuring firewall..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS (for future SSL)
ufw --force enable
echo "Firewall enabled (SSH, HTTP, HTTPS allowed)"

# ===== 8. Final check =====
step "Running final health check..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/users 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}Health check passed! API responding.${NC}"
else
    warn "API returned HTTP $HTTP_CODE. Check logs: journalctl -u atlas -f"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}  ATLAS DEPLOYMENT COMPLETE!${NC}"
echo "=========================================="
echo ""
echo "  Your app is live at:"
echo "    Atlas (Jira)  → http://YOUR_SERVER_IP"
echo "    Atlas Wiki    → http://YOUR_SERVER_IP/wiki"
echo ""
echo "  Default login:"
echo "    Email: kunal@example.com"
echo "    Password: password123"
echo ""
echo "  Useful commands:"
echo "    View logs     → journalctl -u atlas -f"
echo "    Restart app   → sudo systemctl restart atlas"
echo "    Stop app      → sudo systemctl stop atlas"
echo "    App status    → sudo systemctl status atlas"
echo "    Nginx logs    → tail -f /var/log/nginx/error.log"
echo ""
echo "  IMPORTANT: Change the default passwords after first login!"
echo "=========================================="
