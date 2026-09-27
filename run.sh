#!/usr/bin/env bash
# Opsiyon Masası'nı kurar (ilk seferde) ve başlatır: http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "→ Python ortamı kuruluyor…"
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r backend/requirements.txt
fi

if [ ! -f frontend/dist/index.html ] || [ "${REBUILD:-0}" = "1" ]; then
  echo "→ Arayüz derleniyor…"
  (cd frontend && npm install --silent && npm run build)
fi

PORT="${PORT:-8000}"
echo "→ http://localhost:$PORT adresinde başlatılıyor (durdurmak için Ctrl+C)"
( sleep 2 && open "http://localhost:$PORT" >/dev/null 2>&1 || true ) &
cd backend
exec ../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
