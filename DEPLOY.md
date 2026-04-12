# Atlas — Docker + GitHub Actions Deployment Guide

## Architecture

```
GitHub (push to main)
  → GitHub Actions CI/CD
    → Run tests (188 tests)
    → Build Docker image
    → SSH into server → pull code → docker compose up
```

```
Server (YOUR_SERVER_IP)
┌──────────────────────────────┐
│  Docker Compose              │
│  ┌────────┐   ┌───────────┐ │
│  │ Nginx  │──▶│ Node.js   │ │
│  │ :80    │   │ :3001     │ │
│  └────────┘   └───────────┘ │
│                 │            │
│          ┌──────┴──────┐    │
│          │ SQLite Vol  │    │
│          └─────────────┘    │
└──────────────────────────────┘
```

---

## Step 1: Server Setup (One-Time)

SSH into your server and run the setup script:

```bash
ssh root@YOUR_SERVER_IP
```

```bash
# Install Docker, create atlas user, configure firewall
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin git

# Create deploy user
useradd -m -s /bin/bash -G docker atlas
mkdir -p /opt/atlas
chown atlas:atlas /opt/atlas

# Firewall
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Or run the automated script:
```bash
bash scripts/server-setup.sh
```

---

## Step 2: Push Code to GitHub

```bash
cd Atlas
git init
git add .
git commit -m "Initial commit — Atlas full-stack app"
git branch -M main
git remote add origin git@github.com:YOUR_USERNAME/atlas.git
git push -u origin main
```

---

## Step 3: Configure GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret Name | Value |
|---|---|
| `SERVER_HOST` | `YOUR_SERVER_IP` |
| `SERVER_USER` | `atlas` (or `root`) |
| `SSH_PRIVATE_KEY` | Your SSH private key (full content including BEGIN/END lines) |
| `REPO_URL` | `git@github.com:YOUR_USERNAME/atlas.git` |

### Generate SSH Key (if needed)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/atlas_deploy -N "" -C "atlas-deploy"

# Add public key to server
ssh-copy-id -i ~/.ssh/atlas_deploy.pub root@YOUR_SERVER_IP

# Copy private key content → paste as SSH_PRIVATE_KEY secret
cat ~/.ssh/atlas_deploy
```

---

## Step 4: Create GitHub Environment

Go to repo → **Settings** → **Environments** → **New environment** → Name: `production`

Optional: Add required reviewers for manual deployment approval.

---

## Step 5: First Manual Deploy (or wait for CI/CD)

SSH into the server and do the initial deploy:

```bash
ssh atlas@YOUR_SERVER_IP

cd /opt/atlas
git clone git@github.com:YOUR_USERNAME/atlas.git .

# Create environment file
cp .env.example .env
nano .env  # Set SESSION_SECRET to a random string

# Build and start
docker compose up -d --build

# Check status
docker compose ps
docker compose logs -f app
```

After this, every push to `main` will auto-deploy via GitHub Actions.

---

## How CI/CD Works

Every push to `main` triggers this pipeline:

1. **Test** — Installs deps, runs all 188 Jest tests (backend + frontend)
2. **Build** — Builds Docker image, saves as artifact
3. **Deploy** — SSHs into server, pulls latest code, runs `docker compose up -d --build`
4. **Verify** — Waits for health check, shows container status

Pull requests only run the **Test** job (no deploy).

---

## Useful Commands

```bash
# SSH into server
ssh atlas@YOUR_SERVER_IP

# View running containers
docker compose ps

# View logs (live)
docker compose logs -f app
docker compose logs -f nginx

# Restart services
docker compose restart app
docker compose restart nginx

# Full rebuild (after code changes)
docker compose down
docker compose up -d --build

# Database backup
bash scripts/backup.sh

# Enter app container
docker exec -it atlas-app sh

# Check disk usage
docker system df
docker system prune  # cleanup unused images
```

---

## SSL/HTTPS Setup (Optional)

### Option A: Let's Encrypt (Free)

```bash
# Install certbot
apt-get install certbot

# Get certificate (stop nginx first)
docker compose stop nginx
certbot certonly --standalone -d yourdomain.com
docker compose start nginx

# Copy certs to nginx/ssl/
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/
```

Then uncomment the SSL server block in `nginx/nginx.conf` and restart.

### Option B: Self-Signed (Development)

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/CN=YOUR_SERVER_IP"
```

---

## Backup & Recovery

### Automated Backups

```bash
# Add to crontab (daily at 2 AM)
crontab -e
0 2 * * * /opt/atlas/scripts/backup.sh
```

### Manual Backup

```bash
docker cp atlas-app:/app/data/data.db ./backup_$(date +%Y%m%d).db
```

### Restore

```bash
docker compose down
docker cp backup.db atlas-app:/app/data/data.db
docker compose up -d
```

---

## Troubleshooting

**Container won't start:**
```bash
docker compose logs app  # check for errors
docker compose down && docker compose up -d --build  # fresh rebuild
```

**Port 80 already in use:**
```bash
lsof -ti:80  # find what's using it
# Or change NGINX_PORT in .env
```

**Health check failing:**
```bash
docker exec atlas-app wget -qO- http://localhost:3001/api/auth/me
```

**Disk full:**
```bash
docker system prune -a  # remove all unused images
```
