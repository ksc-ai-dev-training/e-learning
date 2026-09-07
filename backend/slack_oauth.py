# Slack OAuth 2.0連携（F-12 Slack受講催促通知）。本人がS-15プロフィール編集で一度連携すると、
# 以後は本人のUser Access Tokenで本人宛てにリマインドを投稿できるようになる。
# Bot User・Bot Token Scopeは使わない（User Token Scopesのみ、chat:write・identity.basic）。
# google_auth.pyと同じ構成（認可URL生成・codeのトークン交換のみを扱う。state管理はrouters/slack.py）。
import os

import httpx

AUTHORIZE_ENDPOINT = "https://slack.com/oauth/v2/authorize"
TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.access"
USER_SCOPES = "chat:write,identity.basic"

SLACK_CLIENT_ID = os.environ.get("SLACK_CLIENT_ID")
SLACK_CLIENT_SECRET = os.environ.get("SLACK_CLIENT_SECRET")


def is_configured() -> bool:
    """SLACK_CLIENT_ID/SECRETが両方設定されているか（未設定ならSlack連携ボタンを無効化する）。"""
    return bool(SLACK_CLIENT_ID and SLACK_CLIENT_SECRET)


def build_authorize_url(state: str, redirect_uri: str) -> str:
    """Slackの認可画面へのURLを組み立てる。user_scopeのみを要求し、Botはインストールしない。"""
    params = {
        "client_id": SLACK_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "user_scope": USER_SCOPES,
        "state": state,
    }
    return f"{AUTHORIZE_ENDPOINT}?{httpx.QueryParams(params)}"


async def exchange_code(code: str, redirect_uri: str) -> dict:
    """認可コードをUser Access Tokenに交換する。レスポンスのauthed_user.id/access_tokenを使う
    （bot_user_id・access_token直下はBot Token Scopeを要求した場合のみ含まれるため、本連携では
    使わない）。"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            TOKEN_ENDPOINT,
            data={
                "client_id": SLACK_CLIENT_ID,
                "client_secret": SLACK_CLIENT_SECRET,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        res.raise_for_status()
        data = res.json()
        if not data.get("ok"):
            raise RuntimeError(f"Slack oauth.v2.access failed: {data.get('error')}")
        return data
