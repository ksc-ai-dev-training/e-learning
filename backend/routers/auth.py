# A-01〜A-04, A-62〜A-63, A-75〜A-77 認証系API。
import hmac
import logging
import os
import secrets
from urllib.parse import urlencode

import google_auth
import storage
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

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


async def _resolve_picture_url(user_id: int, fallback_picture_url: str | None) -> str | None:
    """S-15プロフィール編集で独自アップロードしたアイコン（users.custom_picture_key）があれば
    署名付きURLを解決して返す。無ければGoogleプロフィール画像（users.picture_url）のまま返す。
    毎リクエストではなく/me（A-04）呼び出し時のみ解決する（require_authで毎回呼ぶとSupabase
    Storageへの署名リクエストが全APIコールに乗ってしまうため、2026-09-08）。"""
    key = await get_pool().fetchval("SELECT custom_picture_key FROM users WHERE id = $1", user_id)
    if not key:
        return fallback_picture_url
    download_url, _ = await storage.create_download_url(key)
    return download_url


@router.get("/me")
async def me(user: CurrentUser = Depends(require_auth)):
    # A-04: ログイン中ユーザー情報
    picture_url = await _resolve_picture_url(user.id, user.picture_url)
    return {
        "id": user.id, "email": user.email, "name": user.name,
        "role": user.role, "picture_url": picture_url,
    }


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    custom_picture_key: str | None = None


@router.put("/me")
async def update_me(body: ProfileUpdate, user: CurrentUser = Depends(require_auth)):
    """A-75: 表示名の変更、およびA-76でアップロード済みのアイコンの確定（S-15）。
    custom_picture_keyを新しい値に差し替える場合、古いアップロード実体をストレージから削除する
    （A-27〜A-29と同型のアップロード方式で、確定APIが実体の後始末まで行う設計は本APIが初出のため
    ここで方針を決めた。孤立ファイルの蓄積を防ぐ）。"""
    if body.name is None and body.custom_picture_key is None:
        picture_url = await _resolve_picture_url(user.id, user.picture_url)
        return {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "picture_url": picture_url}

    pool = get_pool()
    old_key = None
    if body.custom_picture_key is not None:
        old_key = await pool.fetchval("SELECT custom_picture_key FROM users WHERE id = $1", user.id)

    row = await pool.fetchrow(
        """UPDATE users SET name = COALESCE($1, name), custom_picture_key = COALESCE($2, custom_picture_key),
               updated_at = now()
           WHERE id = $3
           RETURNING id, email, name, role, picture_url""",
        body.name, body.custom_picture_key, user.id,
    )
    if old_key and old_key != body.custom_picture_key:
        await storage.delete_object(old_key)

    picture_url = await _resolve_picture_url(user.id, row["picture_url"])
    return {
        "id": row["id"], "email": row["email"], "name": row["name"],
        "role": row["role"], "picture_url": picture_url,
    }


class IconUploadRequest(BaseModel):
    filename: str = Field(min_length=1)
    mime_type: str
    size_bytes: int


@router.post("/me/icon/upload-url")
async def request_icon_upload_url(body: IconUploadRequest, user: CurrentUser = Depends(require_auth)):
    """A-76: アイコン画像アップロード用の署名付きURLを発行する（A-27と同じ方式）。
    PNG/JPEGのみ、MAX_ICON_SIZE_MB（既定2MB）まで（詳細設計書4.14a節）。"""
    if body.mime_type not in ("image/png", "image/jpeg"):
        raise HTTPException(422, detail="PNG またはJPEG画像のみアップロードできます")
    max_mb = int(os.environ.get("MAX_ICON_SIZE_MB", "2"))
    if body.size_bytes > max_mb * 1024 * 1024:
        raise HTTPException(413, detail=f"アイコン画像は{max_mb}MB以内にしてください")
    storage_key, upload_url = await storage.create_upload_target(
        prefix=f"users/{user.id}/icon", filename=body.filename, mime_type=body.mime_type,
    )
    return {"upload_url": upload_url, "storage_key": storage_key}


@router.delete("/me/icon")
async def reset_icon(user: CurrentUser = Depends(require_auth)):
    """A-77: 独自アイコンを削除しGoogleプロフィール画像に戻す（custom_picture_keyをNULLに更新）。"""
    pool = get_pool()
    old_key = await pool.fetchval("SELECT custom_picture_key FROM users WHERE id = $1", user.id)
    row = await pool.fetchrow(
        """UPDATE users SET custom_picture_key = NULL, updated_at = now()
           WHERE id = $1
           RETURNING id, email, name, role, picture_url""",
        user.id,
    )
    if old_key:
        await storage.delete_object(old_key)
    return dict(row)
