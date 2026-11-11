#!/usr/bin/env bash
# Export the live workflows from n8n (e.g. after a hot-fix in the UI) so you can
# diff them against the generated versions and port changes back to
# tools/build-workflows.js.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=backups/workflows-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
docker compose exec -T n8n sh -c 'rm -rf /tmp/lre-export && mkdir -p /tmp/lre-export && n8n export:workflow --all --separate --output=/tmp/lre-export'
docker compose cp n8n:/tmp/lre-export/. "$OUT/"
echo "✓ Exported to $OUT — compare with: diff <(jq -S . n8n/workflows/06_ai_conversation_engine.json) <(jq -S . $OUT/<file>.json)"
