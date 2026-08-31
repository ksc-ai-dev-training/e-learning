# A-01〜A-04, A-62〜A-63 認証系API。
import hmac
import logging
import os
import secrets
from urllib.parse import urlencode

import google_auth
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from auth_helpers import (
    CLI_TOKEN_EXPIRES_SECONDS,
    COOKIE_SECURE,
    SESSION_COOKIE,
    CurrentUser,
    issue_jwt,
    require_auth,
)
from database import APP_ENV, get_pool

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger("manabi.auth")

# Google OAuth未設定の間は開発用ログインを有効にする（DEV_AUTH=0で明示無効化）。
# GOOGLE_CLIENT_ID/SECRETが設定されると、本番と同じ経路を強制するため自動的に無効になる。
# APP_ENV=production では DEV_AUTH=1 を指定しても常に無効
# （誰でもメールアドレスだけでログインできてしまうため、本番で有効化する手段を残さない）。
DEV_AUTH = (
    APP_ENV != "production"
    and not google_auth.is_configured()
    and os.environ.get("DEV_AUTH", "1") == "1"
)

OAUTH_STATE_COOKIE = "manabi_oauth_state"
ALLOWED_DOMAINS = [d.strip().lower() for d in os.environ.get("ALLOWED_DOMAINS", "").split(",") if d.strip()]
# CLIログイン用のstateは "<ランダム>.cli.<callback_port>" 形式で埋め込む（詳細設計書7.1節）
_CLI_STATE_MARKER = ".cli."


def _redirect_uri(request: Request) -> str:
    configured = os.environ.get("GOOGLE_REDIRECT_URI")
    if configured:
        return configured
    return str(request.url_for("auth_callback"))


@router.get("/login")
async def auth_login(request: Request):
    """A-01: Google認可URLへリダイレクトする。stateを10分間有効な短命Cookieに保存する。"""
    state = secrets.token_urlsafe(32)
    response = RedirectResponse(google_auth.build_authorize_url(state, _redirect_uri(request)))
    response.set_cookie(
        OAUTH_STATE_COOKIE, state, httponly=True, samesite="lax", path="/",
        secure=COOKIE_SECURE, max_age=600,
    )
    return response


@router.get("/cli/login")
async def auth_cli_login(callback_port: int, request: Request):
    """A-62: CLIヘルパー用。A-01と同じ認可フローを、callback_portをstateに埋め込んで開始する。"""
    state = f"{secrets.token_urlsafe(24)}{_CLI_STATE_MARKER}{callback_port}"
    response = RedirectResponse(google_auth.build_authorize_url(state, _redirect_uri(request)))
    response.set_cookie(
        OAUTH_STATE_COOKIE, state, httponly=True, samesite="lax", path="/",
        secure=COOKIE_SECURE, max_age=600,
    )
    return response


@router.get("/callback", name="auth_callback")
async def auth_callback(request: Request, code: str | None = None, state: str | None = None):
    """A-02: Googleからのコールバック。処理フローは詳細設計書4.1節参照。"""
    expected_state = request.cookies.get(OAUTH_STATE_COOKIE)

    def _deny(error: str) -> RedirectResponse:
        logger.info("event=login_denied error=%s", error)
        base = os.environ.get("FRONTEND_URL", "/").rstrip("/")
        r = RedirectResponse(f"{base}/login?error={error}")
        r.delete_cookie(OAUTH_STATE_COOKIE, path="/")
        return r

    if not code or not state or not expected_state or not hmac.compare_digest(state, expected_state):
        return _deny("invalid_request")

    callback_port: int | None = None
    if _CLI_STATE_MARKER in state:
        try:
            callback_port = int(state.rsplit(_CLI_STATE_MARKER, 1)[1])
        except ValueError:
            return _deny("invalid_request")

    try:
        tokens = await google_auth.exchange_code(code, _redirect_uri(request))
        claims = await google_auth.verify_id_token(tokens["id_token"])
    except Exception:
        logger.exception("event=login_denied error=invalid_request（トークン交換・検証失敗）")
        return _deny("invalid_request")

    if not claims.get("email_verified"):
        return _deny("forbidden")

    email = claims["email"]
    domain = email.rsplit("@", 1)[-1].lower()
    if ALLOWED_DOMAINS and domain not in ALLOWED_DOMAINS:
        return _deny("domain")

    picture_url = claims.get("picture")
    pool = get_pool()
    row = await pool.fetchrow("SELECT id, role, is_active FROM users WHERE lower(email) = lower($1)", email)
    if row is None:
        # 初回登録: role='member'・is_active=trueで作成し、全社Wikiにeditorとして自動参加させる
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """INSERT INTO users (email, name, role, picture_url)
                       VALUES ($1, $2, 'member', $3)
                       RETURNING id, role, is_active""",
                    email, claims.get("name") or email, picture_url,
                )
                company_wide_id = await conn.fetchval(
                    "SELECT id FROM projects WHERE is_company_wide = true LIMIT 1"
                )
                if company_wide_id is not None:
                    await conn.execute(
                        """INSERT INTO project_memberships (project_id, user_id, role, status, joined_at)
                           VALUES ($1, $2, 'editor', 'active', now())""",
                        company_wide_id, row["id"],
                    )
    else:
        # 既存ユーザー: nameは本人がS-15で変更している可能性があるため上書きしない（F-29）
        await pool.execute("UPDATE users SET picture_url = $1 WHERE id = $2", picture_url, row["id"])

    if not row["is_active"]:
        return _deny("inactive")

    logger.info("event=login user_id=%s email=%s", row["id"], email)

    if callback_port is not None:
        token = issue_jwt(row["id"], row["role"], token_type="cli", expires_seconds=CLI_TOKEN_EXPIRES_SECONDS)
        redirect_response = RedirectResponse(
            f"http://127.0.0.1:{callback_port}/callback?{urlencode({'token': token})}"
        )
    else:
        token = issue_jwt(row["id"], row["role"])
        redirect_response = RedirectResponse(os.environ.get("FRONTEND_URL", "/"))
        redirect_response.set_cookie(
            SESSION_COOKIE, token, httponly=True, samesite="lax", path="/", secure=COOKIE_SECURE
        )
    redirect_response.delete_cookie(OAUTH_STATE_COOKIE, path="/")
    return redirect_response


@router.post("/cli/revoke")
async def auth_cli_revoke(user: CurrentUser = Depends(require_auth)):
    """A-63: 現在のCLIトークンを失効させる（jtiをcli_token_revocationsに記録）。"""
    if user.token_type != "cli" or not user.jti:
        raise HTTPException(400, detail="CLIトークンでのみ実行できます")
    await get_pool().execute(
        "INSERT INTO cli_token_revocations (jti, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        user.jti, user.id,
    )
    return {"detail": "トークンを失効しました"}


class DevLoginRequest(BaseModel):
    email: str


@router.post("/dev-login")
async def dev_login(body: DevLoginRequest, response: Response):
    """開発用ログイン（Google認証の代替）。登録済みメールアドレスでJWTを発行する。本番では無効。"""
    if not DEV_AUTH:
        raise HTTPException(404, detail="Not Found")
    row = await get_pool().fetchrow(
        "SELECT id, role, is_active FROM users WHERE email = $1", body.email
    )
    if row is None:
        raise HTTPException(403, detail="登録されていないユーザーです")
    if not row["is_active"]:
        raise HTTPException(403, detail="このアカウントは無効化されています")
    token = issue_jwt(row["id"], row["role"])
    response.set_cookie(
        SESSION_COOKIE, token, httponly=True, samesite="lax", path="/", secure=COOKIE_SECURE
    )
    return {"detail": "ログインしました"}


@router.get("/dev-users")
async def dev_users():
    """開発用: ログイン可能なユーザー一覧（S-01のアカウント選択に使用）。本番では無効。"""
    if not DEV_AUTH:
        raise HTTPException(404, detail="Not Found")
    rows = await get_pool().fetch(
        "SELECT email, name, role FROM users WHERE is_active = true ORDER BY id"
    )
    return {"items": [dict(r) for r in rows]}


@router.post("/logout")
async def logout(response: Response, user: CurrentUser = Depends(require_auth)):
    # A-03: セッションCookie破棄
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"detail": "ログアウトしました"}


@router.get("/me")
async def me(user: CurrentUser = Depends(require_auth)):
    # A-04: ログイン中ユーザー情報
    return {
        "id": user.id, "email": user.email, "name": user.name,
        "role": user.role, "picture_url": user.picture_url,
    }
