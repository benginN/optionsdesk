#!/bin/sh
# data/ klasörünü PUID:PGID'ye verir ve sunucuyu o kullanıcıyla başlatır.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R "$PUID:$PGID" /app/data
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi
exec "$@"
