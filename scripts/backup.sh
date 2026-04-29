#!/bin/bash
# ===== Atlas — Database Backup Script =====
# Usage: ./scripts/backup.sh
# Cron:  0 2 * * * /opt/atlas/scripts/backup.sh

set -euo pipefail

BACKUP_DIR="/opt/atlas/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

echo "→ Backing up Atlas database..."

# Copy SQLite DB from Docker volume
docker cp atlas-app:/app/data/data.db "$BACKUP_DIR/atlas_${TIMESTAMP}.db"

# Compress
gzip "$BACKUP_DIR/atlas_${TIMESTAMP}.db"
echo "  ✓ Backup saved: atlas_${TIMESTAMP}.db.gz"

# Cleanup old backups
find "$BACKUP_DIR" -name "atlas_*.db.gz" -mtime +$KEEP_DAYS -delete
echo "  ✓ Cleaned backups older than ${KEEP_DAYS} days"

echo "→ Done."
