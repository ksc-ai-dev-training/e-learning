# Slack個人連携API（F-12 Slack受講催促通知）。S-15プロフィール編集から、本人が一度だけ
# OAuth連携する（google_auth/routers/auth.pyのGoogleログインと同じ構成）。
import hmac
import logging
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

import slack_oauth
from auth_helpers import COOKIE_SECURE, CurrentUser, require_auth
from database import get_pool

router = APIRouter(prefix="/api/slack", tags=["slack"])
logger = logging.getLogger("manabi.slack")

OAUTH_STATE_COOKIE = "manabi_slack_oauth_state"


def _redirect_uri(request: Request) -> str:
    configured = os.environ.get("SLACK_REDIRECT_URI")
    if configured:
        return configured
    return str(request.url_for("slack_callback"))


def _frontend_url() -> str:
    return os.environ.get("FRONTEND_URL", "/").rstrip("/") or "/"


@router.get("/status")
async def get_slack_status(user: CurrentUser = Depends(require_auth)):
    """S-15の連携状態表示用。slack_access_token自体は返さない（機密情報のため）。"""
    row = await get_pool().fetchrow(
        "SELECT slack_user_id, slack_connected_at FROM users WHERE id = $1", user.id
    )
    connected = bool(row and row["slack_user_id"])
    return {
        "connected": connected,
        "connected_at": row["slack_connected_at"] if connected else None,
        "configured": slack_oauth.is_configured(),
    }


@router.get("/connect")
async def slack_connect(request: Request, user: CurrentUser = Depends(require_auth)):
    """本人がS-15で押す「Slack連携する」ボタン。stateを10分間有効な短命Cookieに保存する
    （require_authでの認証はセッションCookie経由のため、コールバック時も同じセッションで
    本人を特定できる。ユーザーIDをstateに含める必要は無い）。"""
    if not slack_oauth.is_configured():
        raise HTTPException(503, detail="Slack連携が設定されていません")
    state = secrets.token_urlsafe(32)
    response = RedirectResponse(slack_oauth.build_authorize_url(state, _redirect_uri(request)))
    response.set_cookie(
        OAUTH_STATE_COOKIE, state, httponly=True, samesite="lax", path="/",
        secure=COOKIE_SECURE, max_age=600,
    )
    return response


@router.get("/callback", name="slack_callback")
async def slack_callback(
    request: Request, code: str | None = None, state: str | None = None, error: str | None = None,
    user: CurrentUser = Depends(require_auth),
):
    """Slackからのコールバック。連携中断・失敗時はプロフィール編集へエラー付きで戻す。"""
    expected_state = request.cookies.get(OAUTH_STATE_COOKIE)

    def _deny(reason: str) -> RedirectResponse:
        logger.info("event=slack_connect_denied user_id=%s reason=%s", user.id, reason)
        r = RedirectResponse(f"{_frontend_url()}/profile?slack_error={reason}")
        r.delete_cookie(OAUTH_STATE_COOKIE, path="/")
        return r

    if error:
        return _deny(error)
    if not code or not state or not expected_state or not hmac.compare_digest(state, expected_state):
        return _deny("invalid_request")

    try:
        data = await slack_oauth.exchange_code(code, _redirect_uri(request))
    except Exception:
        logger.exception("event=slack_connect_denied user_id=%s reason=token_exchange_failed", user.id)
        return _deny("invalid_request")

    authed_user = data.get("authed_user") or {}
    slack_user_id = authed_user.get("id")
    access_token = authed_user.get("access_token")
    if not slack_user_id or not access_token:
        return _deny("invalid_request")

    await get_pool().execute(
        """UPDATE users SET slack_user_id = $1, slack_access_token = $2, slack_connected_at = now()
            WHERE id = $3""",
        slack_user_id, access_token, user.id,
    )
    response = RedirectResponse(f"{_frontend_url()}/profile?slack=connected")
    response.delete_cookie(OAUTH_STATE_COOKIE, path="/")
    return response


@router.post("/disconnect", status_code=204)
async def slack_disconnect(user: CurrentUser = Depends(require_auth)):
    """本人による連携解除。以後、本人へのSlackリマインドは送れなくなる（送信側は
    slack_user_id/slack_access_tokenの有無で「未連携」を判定する）。"""
    await get_pool().execute(
        """UPDATE users SET slack_user_id = NULL, slack_access_token = NULL, slack_connected_at = NULL
            WHERE id = $1""",
        user.id,
    )
