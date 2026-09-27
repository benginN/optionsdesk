#!/usr/bin/env bash
# Sunucu çalışmıyorsa arka planda başlatır, sonra siteyi tarayıcıda açar.
# "Opsiyon Masası.app" bu dosyayı çalıştırır.
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="http://localhost:8000"

if ! curl -s -o /dev/null -m 2 "$URL/api/status"; then
  # İlk kurulum yapılmamışsa run.sh'yi Terminal'de çalıştır (kurulum çıktısı görünsün)
  if [ ! -x "$DIR/.venv/bin/uvicorn" ] || [ ! -f "$DIR/frontend/dist/index.html" ]; then
    open -a Terminal "$DIR/run.sh"
    exit 0
  fi
  mkdir -p "$DIR/data"
  cd "$DIR/backend" || exit 1
  nohup ../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 >> "$DIR/data/server.log" 2>&1 &
  # Sunucu hazır olana kadar en fazla ~20 sn bekle
  for _ in $(seq 1 40); do
    curl -s -o /dev/null -m 1 "$URL/api/status" && break
    sleep 0.5
  done
fi

open "$URL"
