#!/usr/bin/env bash
# Nightly backup of both databases. Add to crontab:
#   15 3 * * * cd /opt/lead-recovery-engine && bash scripts/backup.sh >> backups/backup.log 2>&1
# Ship backups/ off-server (S3, Backblaze B2…) — a backup on the same disk is not a backup.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
TS=$(date +%Y%m%d-%H%M%S); mkdir -p backups
for db in lre n8n; do
  docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$db" > "backups/${db}-${TS}.dump"
done
find backups -name '*.dump' -mtime +14 -delete
echo "✓ backup ${TS}"
# Restore:  docker compose exec -T postgres pg_restore -U $POSTGRES_USER -d lre --clean < backups/lre-<ts>.dump
