#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# deploy-workflows.sh — build + import credentials and workflows into n8n.
# Run on the server from the repo root:   bash scripts/deploy-workflows.sh
#
#   --no-activate   import only, leave workflows inactive (default activates)
# -----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

ACTIVATE=true
[[ "${1:-}" == "--no-activate" ]] && ACTIVATE=false

echo "→ Building workflows from source"
node tools/build-workflows.js

echo "→ Rendering credentials"
RENDERED=n8n/credentials/credentials.rendered.json
trap 'rm -f "$RENDERED"' EXIT
envsubst < n8n/credentials/credentials.template.json > "$RENDERED"

echo "→ Importing credentials"
docker compose cp "$RENDERED" n8n:/tmp/lre-credentials.json
docker compose exec -T n8n n8n import:credentials --input=/tmp/lre-credentials.json
docker compose exec -T n8n rm -f /tmp/lre-credentials.json

echo "→ Importing workflows"
docker compose exec -T n8n sh -c 'mkdir -p /tmp/lre-wf && rm -f /tmp/lre-wf/*.json'
for f in n8n/workflows/[0-9]*.json; do docker compose cp "$f" "n8n:/tmp/lre-wf/$(basename "$f")"; done
docker compose exec -T n8n n8n import:workflow --separate --input=/tmp/lre-wf

if $ACTIVATE; then
  echo "→ Activating trigger workflows"
  # Sub-workflows (03,06,07,08-sub,09,14,15) do not need activation; activating is harmless.
  for id in $(node -e 'console.log(require("./n8n/workflows/_index.json").map(w=>w.id).join(" "))'); do
    docker compose exec -T n8n n8n update:workflow --id="$id" --active=true >/dev/null
  done
  echo "→ Restarting n8n so activation takes effect"
  docker compose restart n8n n8n-worker
fi

echo "✓ Deployed. Open ${APP_BASE_URL} to review."
