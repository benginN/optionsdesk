# --- 1) Arayüzü derle ----------------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- 2) Python sunucusu ----------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
# tzdata: zamanlayıcı America/New_York saatini kullanıyor
RUN pip install -r backend/requirements.txt tzdata

COPY backend/ backend/
COPY --from=frontend /src/frontend/dist frontend/dist

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Snapshot geçmişi, işlem defteri ve ayarlar burada tutulur: volume olarak bağla.
# Sunucu PUID/PGID (varsayılan 1000) kullanıcısıyla çalışır, root olarak değil.
VOLUME ["/app/data"]

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health', timeout=4)" || exit 1

WORKDIR /app/backend
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
