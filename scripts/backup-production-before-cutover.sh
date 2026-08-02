#!/usr/bin/env bash
set -euo pipefail
umask 077

DATA_DIR="${DATA_DIR:-/root/.9router}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/.9router/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/pre-rdm-cutover-$STAMP"

if [[ ! -d "$DATA_DIR" ]]; then
  echo "ERROR: DATA_DIR does not exist: $DATA_DIR" >&2
  exit 1
fi
mkdir -p "$DEST"

# Copy data without stopping the official container. SQLite is copied with
# sqlite3 backup when available; otherwise preserve a raw copy and warn.
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$DATA_DIR/data.sqlite" ]]; then
  sqlite3 "$DATA_DIR/data.sqlite" ".backup '$DEST/data.sqlite'"
elif [[ -f "$DATA_DIR/data.sqlite" ]]; then
  cp -p "$DATA_DIR/data.sqlite" "$DEST/data.sqlite.raw"
  echo "WARNING: sqlite3 unavailable; raw copy created while service may be active" >&2
fi

for item in settings.json usage.json request-details.json log.txt; do
  [[ -e "$DATA_DIR/$item" ]] && cp -a "$DATA_DIR/$item" "$DEST/"
done

# Preserve the complete WARP/host configuration separately; do not delete identities.
if [[ -d /root/multi-warp ]]; then
  tar -C /root -czf "$DEST/multi-warp-config.tgz" multi-warp
fi
sha256sum "$DEST"/* > "$DEST/SHA256SUMS" 2>/dev/null || true
printf 'BACKUP=%s\n' "$DEST"
