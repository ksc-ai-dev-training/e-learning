# FastAPIアプリ生成、ルーター登録、起動設定（詳細設計書 2章）
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import database
import job_sweep
from routers import assignments, auth, learning, materials, organization, reports, settings, uploads, users


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


@app.get("/healthz", include_in_schema=False)
async def healthz():
    """簡易ヘルスチェック。DBまで疎通しているかを確認する"""
    try:
        await database.get_pool().fetchval("SELECT 1")
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unhealthy"})
    return {"status": "ok", "env": database.APP_ENV}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    import traceback
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": "サーバーエラーが発生しました"})


if __name__ == "__main__":
    # `python main.py` で起動する場合もルートの .env の BACKEND_PORT を反映する
    import os

    import uvicorn

    port = int(database.ROOT_ENV.get("BACKEND_PORT") or os.environ.get("BACKEND_PORT", "8020"))
    uvicorn.run("main:app", port=port, reload=True)
