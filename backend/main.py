# FastAPIアプリ生成、ルーター登録、起動設定（詳細設計書 2章）
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import database
import job_sweep
from routers import assignments, auth, dashboard, learning, materials, organization, reports, settings, uploads, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.init_pool()
    sweep_task = asyncio.create_task(job_sweep.run_periodic_sweep())
    yield
    sweep_task.cancel()
    await database.close_pool()


app = FastAPI(title="Manabi API", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(organization.router)
app.include_router(organization.memberships_router)
app.include_router(materials.router)
app.include_router(materials.detail_router)
app.include_router(learning.router)
app.include_router(uploads.router)
app.include_router(assignments.router)
app.include_router(users.router)
app.include_router(settings.router)
app.include_router(reports.router)
app.include_router(reports.org_router)
app.include_router(dashboard.router)


@app.get("/healthz", include_in_schema=False)
async def healthz():
    """簡易ヘルスチェック。DBまで疎通しているかを確認する。Cache-Control: no-storeを明示する
    （2026-09-09。本番でFly.ioのエッジと思われる箇所に、/healthz実装前のSPAフォールバック
    レスポンスが一時的にキャッシュされ、実際には健全なのに古い応答が返り続ける事象が確認された
    ため、今後同様の問題が起きないよう予防的に付与）。"""
    no_store = {"Cache-Control": "no-store"}
    try:
        await database.get_pool().fetchval("SELECT 1")
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unhealthy"}, headers=no_store)
    return JSONResponse(content={"status": "ok", "env": database.APP_ENV}, headers=no_store)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    import traceback
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": "サーバーエラーが発生しました"})


# Fly.io本番デプロイ用: フロントエンド（Vite build成果物）をバックエンドと同一オリジンで
# 配信する単一アプリ構成（セッションCookieのsamesite=laxをそのまま使え、CORS設定が不要になる
# ため採用。デプロイ検討資料参照）。Dockerfileがfrontend/distをbackend/staticへコピーする。
# ローカル開発ではbackend/staticが存在しないため何もしない（Vite開発サーバーが別途配信する）。
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        """React Router（BrowserRouter）のクライアントサイドルーティング対応。/api・/assets・
        /healthz以外の未知のパス（直接URLアクセス・リロード含む）は全てindex.htmlを返す。
        publicディレクトリ由来の静的ファイル（favicon等）が直接dist直下にある場合はそれを返す。
        /api/配下は、このワイルドカードルートが他の全ルーターより後に登録されているため通常は
        ここまで来ないが、存在しないAPIパス（誤字等）の場合はここに来てしまい、index.htmlを
        200で返す誤動作になるため、/apiで始まる場合は明示的に404を返す。"""
        if full_path.startswith("api/") or full_path == "api":
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        candidate = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))


if __name__ == "__main__":
    # `python main.py` で起動する場合もルートの .env の BACKEND_PORT を反映する
    import os

    import uvicorn

    port = int(database.ROOT_ENV.get("BACKEND_PORT") or os.environ.get("BACKEND_PORT", "8020"))
    uvicorn.run("main:app", port=port, reload=True)
