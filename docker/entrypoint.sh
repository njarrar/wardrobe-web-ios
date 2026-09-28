#!/bin/sh
# Prepares the data folder, then starts the server. When the container runs as
# root, the server itself switches to PUID:PGID (see scripts/serve.mjs) so files
# written to the mounted NAS folder are owned by your DSM user. Find yours with
# `id` over SSH; the first admin user on Synology is usually 1026:100.
set -e

DATA_DIR="${WARDROBE_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  # Only fix ownership when it is wrong, so big closets start quickly.
  if [ "$(stat -c %u "$DATA_DIR")" != "$PUID" ] || [ "$(stat -c %g "$DATA_DIR")" != "$PGID" ]; then
    echo "Setting ownership of $DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA_DIR" || echo "Warning: could not change ownership of $DATA_DIR" >&2
  fi
fi

exec "$@"
