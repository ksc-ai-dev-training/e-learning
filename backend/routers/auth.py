# A-01〜A-04 認証系API。
# Google OAuth（A-01/A-02）はまだ実装せず、開発用ログイン（dev-login）のみを用意する。
# 実装時期はF-29等の後続ステップで、実際にGoogle Cloud Consoleの認証情報を用意してから対応する。
import os

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from auth_helpers import COOKIE_SECURE, SESSION_COOKIE, CurrentUser, issue_jwt, require_auth
from database import APP_ENV, get_pool

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Google OAuth未設定の間は開発用ログインを有効にする（DEV_AUTH=0で明示無効化）。
# APP_ENV=production では DEV_AUTH=1 を指定しても常に無効
# （誰でもメールアドレスだけでログインできてしまうため、本番で有効化する手段を残さない）。
DEV_AUTH = APP_ENV != "production" and os.environ.get("DEV_AUTH", "1") == "1"


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
