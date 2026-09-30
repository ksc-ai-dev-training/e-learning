# FastAPIアプリ生成、ルーター登録、起動設定（詳細設計書 2章）
import asyncio
import os
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import database
import job_sweep
from mcp_server import mcp_asgi_app
from routers import assignments, auth, dashboard, learning, materials, organization, reports, settings, uploads, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.init_pool()
    sweep_task = asyncio.create_task(job_sweep.run_periodic_sweep())
    # MCPサーバー（mcp_asgi_app）はASGIのマウント先として登録するだけでは自身のlifespan
    # （セッションマネージャーの起動・後片付け）が呼ばれないため、親アプリのlifespan内で
    # 明示的にenter_async_contextする（2026-09-14、MCPサーバー新設に伴い対応）。
    async with AsyncExitStack() as mcp_stack:
        await mcp_stack.enter_async_context(mcp_asgi_app.router.lifespan_context(mcp_asgi_app))
        yield
    sweep_task.cancel()
    await database.close_pool()


app = FastAPI(title="Manabi API", lifespan=lifespan)


class _McpTrailingSlash:
    """/mcp（末尾スラッシュなし）を/mcp/に読み替える。app.mount("/mcp", ...)は/mcp/以下にしか
    一致せず、本番ではSPAフォールバック（GET /{full_path:path}、下記STATIC_DIR部分）に先に
    捕まってPOSTが405 Method Not Allowedになる（ローカルはbackend/staticが無くSPAフォールバックが
    登録されないため、Starletteの307リダイレクトで/mcp/に転送されて動いていた）。手順書が案内する
    登録URL（末尾スラッシュなし）を変えずに済むよう、ここでパスを書き換える（2026-09-14）。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] == "/mcp":
            scope = dict(scope, path="/mcp/", raw_path=b"/mcp/")
        await self.app(scope, receive, send)


app.add_middleware(_McpTrailingSlash)

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
app.mount("/mcp", mcp_asgi_app)


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


def _translate_validation_error(err: dict) -> str:
    """PydanticのRequestValidationErrorは既定で英語（"String should have at most 100
    characters"等）のため、他のエラー（HTTPExceptionのdetail）と同じく画面にそのまま出しても
    読めない。頻出する型だけ日本語に置き換え、未知の型は元のmsgのままフォールバックする
    （2026-09-16、プロジェクト名の文字数超過エラーが英語のまま表示されるとの指摘を受け対応）。"""
    etype = err.get("type")
    ctx = err.get("ctx", {})
    if etype == "string_too_long":
        return f"{ctx.get('max_length')}文字以内で入力してください"
    if etype == "string_too_short":
        return f"{ctx.get('min_length')}文字以上で入力してください"
    if etype == "missing":
        return "入力してください"
    if etype == "value_error":
        # model_validatorが`raise ValueError("...")`したメッセージ自体は既に日本語で書いて
        # いる（QuestionIn._validate_by_type等）が、pydantic v2はmsgの先頭に固定で
        # "Value error, "という英語プレフィックスを付ける仕様のため、それだけ取り除く
        # （2026-09-16、このハンドラ新設時の見直しで発見。PUT /questions等FastAPIが自動で
        # bodyをパースするエンドポイントでraise ValueErrorすると、このプレフィックスが
        # そのまま日本語メッセージの前に残ってしまっていた）。
        msg = err.get("msg", "")
        prefix = "Value error, "
        return msg[len(prefix):] if msg.startswith(prefix) else msg
    return err.get("msg", "入力内容を確認してください")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    messages = [_translate_validation_error(err) for err in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": " / ".join(messages)})


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
