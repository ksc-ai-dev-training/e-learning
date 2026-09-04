# Fly.io本番デプロイ用（検討資料/参照）。フロントエンド（Vite build）をバックエンド
# （FastAPI）と同一オリジンで配信する単一アプリ構成。backend/main.pyのSTATIC_DIR配信ロジックと対。

# ---- 1. フロントエンドのビルド ----
FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. バックエンド本体 ----
FROM python:3.13-slim AS backend
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# フロントエンドのビルド成果物をbackend/staticへ配置する（main.pyのSTATIC_DIR）
COPY --from=frontend-build /app/frontend/dist ./static

ENV APP_ENV=production
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
