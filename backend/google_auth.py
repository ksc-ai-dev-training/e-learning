# Google OAuth 2.0 / OpenID Connect 連携（A-01/A-02, A-62。詳細設計書4.1節）。
# 認可URL生成・codeのトークン交換・IDトークン検証のみを扱う（state管理・ユーザー登録は routers/auth.py）。
import os
import time

import httpx
import jwt

AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs"
ALLOWED_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

# GoogleのJWKS（署名検証用の公開鍵セット）はごく低頻度でしか変わらないため、プロセス内に
# 短時間キャッシュする（毎リクエストGoogleへ取りに行かない）。
_jwks_cache: dict | None = None
_jwks_cached_at: float = 0.0
JWKS_CACHE_SECONDS = 6 * 3600


def is_configured() -> bool:
    """GOOGLE_CLIENT_ID/SECRETが両方設定されているか（未設定ならGoogle OAuthを使わない＝dev-loginのみ）。"""
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


def build_authorize_url(state: str, redirect_uri: str) -> str:
    """A-01/A-62共通。Googleの認可画面へのURLを組み立てる。"""
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    return f"{AUTHORIZE_ENDPOINT}?{httpx.QueryParams(params)}"


async def exchange_code(code: str, redirect_uri: str) -> dict:
    """A-02処理フロー2。認可コードをGoogleのトークンエンドポイントでid_token等に交換する。"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        res.raise_for_status()
        return res.json()


async def _get_jwks() -> dict:
    global _jwks_cache, _jwks_cached_at
    now = time.time()
    if _jwks_cache is not None and (now - _jwks_cached_at) < JWKS_CACHE_SECONDS:
        return _jwks_cache
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(JWKS_ENDPOINT)
        res.raise_for_status()
        _jwks_cache = res.json()
        _jwks_cached_at = now
        return _jwks_cache


async def verify_id_token(id_token: str) -> dict:
    """A-02処理フロー2。GoogleのJWKSで署名・発行者・audience・有効期限を検証し、claims
    （email, email_verified, name, picture等）を返す。検証失敗はjwt.PyJWTError系を送出する。

    leewayは、このマシンのシステム時計とGoogleサーバーの時刻とのわずかなズレを許容するため
    （PyJWTのiat/exp検証はデフォルトで秒単位まで厳密なため、数秒の時計ズレだけで
    ImmatureSignatureError等になっていた不具合を発見・修正。2026-08-31）。"""
    jwks = await _get_jwks()
    header = jwt.get_unverified_header(id_token)
    key_data = next(k for k in jwks["keys"] if k["kid"] == header["kid"])
    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key_data)
    claims = jwt.decode(
        id_token,
        key=public_key,
        algorithms=["RS256"],
        audience=GOOGLE_CLIENT_ID,
        options={"require": ["exp", "iat", "aud", "iss"]},
        leeway=30,
    )
    if claims.get("iss") not in ALLOWED_ISSUERS:
        raise jwt.InvalidIssuerError(f"unexpected issuer: {claims.get('iss')}")
    return claims
