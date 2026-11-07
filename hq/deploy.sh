#!/usr/bin/env bash
# Rebuild hq/workflow.json and deploy it to n8n on kaakserver (replaces the live workflow and restarts n8n).
# Needs: Tailscale on, and SSH access to kaakserver (ask Kanishk to add your public key).
#
#   RG_SSH_KEY=~/.ssh/your_key ./hq/deploy.sh
#
# Credentials (API keys) live inside n8n and are not touched by this script.
set -euo pipefail

HOST="${RG_HOST:-100.85.160.126}"
USER_="${RG_SSH_USER:-koopatroopa787}"
KEY="${RG_SSH_KEY:-$HOME/.ssh/kaakserver_ed25519}"
CONTAINER=relief-grid-n8n
WORKFLOW_ID=reliefGridHQ0001

cd "$(dirname "$0")/.."
node hq/build_workflow.mjs

ssh_opts=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes)
scp -q "${ssh_opts[@]}" hq/workflow.json "$USER_@$HOST:/tmp/relief_grid_workflow.json"
ssh "${ssh_opts[@]}" "$USER_@$HOST" "set -e
docker cp -q /tmp/relief_grid_workflow.json $CONTAINER:/tmp/relief_grid_workflow.json
docker exec $CONTAINER n8n import:workflow --input=/tmp/relief_grid_workflow.json >/dev/null 2>&1
docker exec $CONTAINER n8n publish:workflow --id=$WORKFLOW_ID >/dev/null 2>&1
docker exec $CONTAINER rm -f /tmp/relief_grid_workflow.json
rm -f /tmp/relief_grid_workflow.json
docker restart $CONTAINER >/dev/null
for i in \$(seq 1 40); do curl -sf http://$HOST:5678/healthz >/dev/null && { echo 'deployed, n8n healthy'; exit 0; }; sleep 2; done
echo 'n8n did not come back within 80 s' >&2; exit 1"
