# Atlas Deployment Guide

## Server: YOUR_SERVER_IP

## Prerequisites
- A server running Ubuntu 20.04+ or Debian 11+ (most common for VPS/cloud)
- SSH access to the server (root or sudo user)
- The Atlas project folder on your local machine

---

## Step 1: Check if You Can SSH Into Your Server

Open Terminal (Mac) or PowerShell (Windows) and run:

```
ssh root@YOUR_SERVER_IP
```

If your hosting provider gave you a **username and password**, use:
```
ssh username@YOUR_SERVER_IP
```

If you can't SSH, check your hosting provider's dashboard — they usually have a "Console" or "Terminal" option in the web panel.

**First time connecting?** Type `yes` when asked about the fingerprint.

---

## Step 2: Upload the Atlas Project to Your Server

**From your local machine** (not the server), run this command:

```bash
# Upload the entire Atlas folder to the server
scp -r /path/to/Atlas root@YOUR_SERVER_IP:/root/Atlas
```

Replace `/path/to/Atlas` with wherever Atlas is on your computer. On Mac, it's likely:
```bash
scp -r ~/Documents/Ticket/Atlas root@YOUR_SERVER_IP:/root/Atlas
```

**Alternative: Using FileZilla (if you prefer a GUI)**
1. Download FileZilla (free) from filezilla-project.org
2. Connect: Host=YOUR_SERVER_IP, Username=root, Password=yourpassword, Port=22
3. Drag the Atlas folder into /root/ on the server

---

## Step 3: Run the Setup Script

SSH into your server and run:

```bash
ssh root@YOUR_SERVER_IP
cd /root/Atlas/deploy
sudo bash setup.sh
```

This single script does everything automatically:
- Installs Node.js 20
- Installs and configures Nginx (reverse proxy)
- Creates a system user for the app
- Copies files to /opt/atlas
- Installs npm dependencies
- Sets up auto-start on boot (systemd)
- Configures the firewall
- Generates a secure session secret

The script takes about 2–3 minutes.

---

## Step 4: Verify It's Working

After the script finishes, open your browser and go to:

- **Atlas (Jira):** http://YOUR_SERVER_IP
- **Atlas Wiki:** http://YOUR_SERVER_IP/wiki

Default login credentials:
- Email: `kunal@example.com`
- Password: `password123`

---

## Useful Commands (Run on the Server)

| Command | What it does |
|---------|-------------|
| `sudo systemctl status atlas` | Check if Atlas is running |
| `sudo systemctl restart atlas` | Restart the application |
| `sudo systemctl stop atlas` | Stop the application |
| `journalctl -u atlas -f` | View live application logs |
| `tail -f /var/log/nginx/error.log` | View Nginx error logs |

---

## Updating the App Later

When you make changes locally and want to update the server:

```bash
# From your local machine - upload the updated files
scp -r /path/to/Atlas/backend root@YOUR_SERVER_IP:/opt/atlas/
scp -r /path/to/Atlas/frontend root@YOUR_SERVER_IP:/opt/atlas/

# SSH in and restart
ssh root@YOUR_SERVER_IP
cd /opt/atlas/backend && npm install --production
sudo systemctl restart atlas
```

---

## Troubleshooting

**Can't connect via SSH?**
- Make sure port 22 is open in your hosting provider's firewall/security group
- Try using the hosting provider's web console instead

**Page shows "502 Bad Gateway"?**
- The Node.js app isn't running: `sudo systemctl start atlas`
- Check logs: `journalctl -u atlas -f`

**Page shows "403 Forbidden" or blank page?**
- Nginx may not be configured: `sudo systemctl restart nginx`
- Check: `sudo nginx -t` for config errors

**App crashes on start?**
- Check the error: `journalctl -u atlas --no-pager | tail -50`
- Usually a missing npm package: `cd /opt/atlas/backend && npm install`

---

## Optional: Add SSL (HTTPS) with Let's Encrypt

If you get a domain name pointing to YOUR_SERVER_IP:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

This automatically configures HTTPS and auto-renews the certificate.
