#!/usr/bin/env bash
set -euo pipefail
umask 077

# Manual rollback helper. This script is intentionally not invoked automatically.
# It starts the official image only after the caller has stopped the RDM container.
IMAGE="${OFFICIAL_IMAGE:-decolua/9router:latest}"
PORT="${PORT:-20128}"
DATA_DIR="${DATA_DIR:-/root/.9router}"

if docker ps --format '{{.Names}}' | grep -qx '9router-rdm'; then
  echo 'ERROR: stop/remove 9router-rdm before running rollback' >&2
  exit 1
fi

docker rm -f 9router >/dev/null 2>&1 || true
docker run -d --name 9router --restart=always -p "0.0.0.0:${PORT}:20128" \
  -v "$DATA_DIR:/app/data" \
  -v /etc/localtime:/etc/localtime:ro \
  -v /usr/share/zoneinfo:/usr/share/zoneinfo:ro \
  -e DATA_DIR=/app/data -e PORT=20128 -e HOSTNAME=0.0.0.0 \
  -e NODE_ENV=production -e NEXT_TELEMETRY_DISABLED=1 \
  "$IMAGE" >/tmp/9router-rollback-container-id

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:${PORT}/api/health >/tmp/9router-rollback-health; then
    cat /tmp/9router-rollback-health
    exit 0
  fi
  sleep 2
done
echo 'ERROR: official rollback healthcheck failed' >&2
exit 1
