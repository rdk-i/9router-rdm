#!/usr/bin/env bash
set -euo pipefail
umask 077

IMAGE="${1:-9router-rdm:v0.5.45-rdm2}"
[[ -n "$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null)" ]] || { echo "ERROR: image missing: $IMAGE" >&2; exit 1; }

for c in 9router; do
  [[ "$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || true)" == running ]] || { echo "ERROR: official container is not running" >&2; exit 1; }
done

health=$(curl -fsS http://127.0.0.1:20128/api/health)
[[ "$health" == *'"ok":true'* ]] || { echo "ERROR: official health failed: $health" >&2; exit 1; }

staging_health=$(curl -fsS http://127.0.0.1:20130/api/health)
[[ "$staging_health" == *'"ok":true'* ]] || { echo "ERROR: staging health failed: $staging_health" >&2; exit 1; }

printf 'IMAGE=%s\nOFFICIAL_HEALTH=%s\nSTAGING_HEALTH=%s\n' "$IMAGE" "$health" "$staging_health"
echo 'READY_FOR_MANUAL_CUTOVER=NO_ACTION_TAKEN'
