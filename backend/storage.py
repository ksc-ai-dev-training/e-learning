# 添付ファイルの実体保存（詳細設計書07_教材連携詳細.html 7.6節）。
# SUPABASE_URL/SUPABASE_SERVICE_KEYが未設定（ローカル開発）ならbackend/uploads/への
# ファイルシステム保存、設定済み（本番）ならSupabase Storageへ自動的に切り替える。
from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from pathlib import Path

import httpx

from auth_helpers import JWT_SECRET
from database import ROOT_ENV
import os

SUPABASE_URL = os.environ.get("SUPABASE_URL") or ROOT_ENV.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or ROOT_ENV.get("SUPABASE_SERVICE_KEY")
SUPABASE_STORAGE_BUCKET = (
    os.environ.get("SUPABASE_STORAGE_BUCKET") or ROOT_ENV.get("SUPABASE_STORAGE_BUCKET") or "manabi-uploads"
)
IS_SUPABASE_CONFIGURED = bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)

UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"


def _make_storage_key(prefix: str, filename: str) -> str:
    ext = Path(filename).suffix
    return f"{prefix}/{uuid.uuid4().hex}{ext}"


def _local_path(storage_key: str) -> Path:
    """パストラバーサル防止。storage_keyの各セグメントに`.`/`..`/空文字を許さない。"""
    parts = storage_key.split("/")
    if any(p in ("", ".", "..") for p in parts):
        raise ValueError("不正なstorage_keyです")
    return UPLOADS_DIR.joinpath(*parts)


LOCAL_URL_TTL_SECONDS = 600


def _sign_local_url(storage_key: str, expires: int) -> str:
    msg = f"{storage_key}:{expires}".encode()
    return hmac.new(JWT_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def make_local_signed_query(storage_key: str) -> tuple[str, int]:
    """ローカル開発用アップロード・ダウンロードURLに付与する署名クエリを発行する。
    本番のSupabase Storage署名付きURL（有効期限600秒、対象storage_key限定）と同等の
    保護をローカルでも持たせるため追加した（2026-09-02、コードレビューで発見・修正。
    以前はrequire_authのみで、storage_keyさえ知っていれば無期限に閲覧・上書きできた）。
    戻り値: (クエリ文字列, expiresのUnix時刻)。"""
    expires = int(time.time()) + LOCAL_URL_TTL_SECONDS
    sig = _sign_local_url(storage_key, expires)
    return f"?expires={expires}&sig={sig}", expires


def verify_local_signed_query(storage_key: str, expires: int, sig: str) -> bool:
    """`make_local_signed_query`が発行した署名を検証する（`uploads.py`のGET/PUTから呼ぶ）。"""
    if time.time() > expires:
        return False
    expected = _sign_local_url(storage_key, expires)
    return hmac.compare_digest(expected, sig)


async def create_upload_target(prefix: str, filename: str, mime_type: str) -> tuple[str, str]:
    """アップロード先を発行する（A-27）。戻り値: (storage_key, upload_url)。"""
    storage_key = _make_storage_key(prefix, filename)
    if IS_SUPABASE_CONFIGURED:
        upload_url = await _supabase_create_signed_upload_url(storage_key)
    else:
        query, _ = make_local_signed_query(storage_key)
        upload_url = f"/api/uploads/{storage_key}{query}"
    return storage_key, upload_url


async def create_download_url(storage_key: str) -> tuple[str, str | None]:
    """ダウンロードURLを発行する（A-30）。戻り値: (download_url, expires_at ISO8601 or None)。"""
    if IS_SUPABASE_CONFIGURED:
        return await _supabase_create_signed_download_url(storage_key)
    import datetime

    query, expires = make_local_signed_query(storage_key)
    expires_at = datetime.datetime.fromtimestamp(expires, tz=datetime.timezone.utc).isoformat()
    return f"/api/uploads/{storage_key}{query}", expires_at


async def copy_object(src_storage_key: str, dest_prefix: str, filename: str) -> str:
    """既存の添付ファイル実体を新しいstorage_keyへ複製する（F-26、教材のプロジェクト間共有の
    複製時に使う。7.6節）。戻り値: 新しいstorage_key。"""
    dest_storage_key = _make_storage_key(dest_prefix, filename)
    if IS_SUPABASE_CONFIGURED:
        await _supabase_copy_object(src_storage_key, dest_storage_key)
    else:
        data = read_local_file(src_storage_key)
        save_local_file(dest_storage_key, data)
    return dest_storage_key


async def delete_object(storage_key: str) -> None:
    """実体ファイルを削除する（A-82）。存在しなくてもエラーにしない。"""
    if IS_SUPABASE_CONFIGURED:
        await _supabase_delete_object(storage_key)
        return
    path = _local_path(storage_key)
    if path.exists():
        path.unlink()


def save_local_file(storage_key: str, data: bytes) -> None:
    """`PUT /api/uploads/{storage_key}` から呼ばれる（ローカル開発専用経路）。"""
    path = _local_path(storage_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def read_local_file(storage_key: str) -> bytes:
    """`GET /api/uploads/{storage_key}` から呼ばれる（ローカル開発専用経路）。"""
    path = _local_path(storage_key)
    if not path.exists():
        raise FileNotFoundError(storage_key)
    return path.read_bytes()


async def _supabase_create_signed_upload_url(storage_key: str) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/upload/sign/{SUPABASE_STORAGE_BUCKET}/{storage_key}",
            headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
        )
        resp.raise_for_status()
        token = resp.json()["token"]
        return f"{SUPABASE_URL}/storage/v1/object/upload/sign/{SUPABASE_STORAGE_BUCKET}/{storage_key}?token={token}"


async def _supabase_create_signed_download_url(storage_key: str) -> tuple[str, str]:
    import datetime

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/sign/{SUPABASE_STORAGE_BUCKET}/{storage_key}",
            headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
            json={"expiresIn": 600},
        )
        resp.raise_for_status()
        signed_path = resp.json()["signedURL"]
        expires_at = (
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=600)
        ).isoformat()
        return f"{SUPABASE_URL}/storage/v1{signed_path}", expires_at


async def _supabase_copy_object(src_storage_key: str, dest_storage_key: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/copy",
            headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
            json={
                "bucketId": SUPABASE_STORAGE_BUCKET,
                "sourceKey": src_storage_key,
                "destinationKey": dest_storage_key,
            },
        )
        resp.raise_for_status()


async def _supabase_delete_object(storage_key: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.request(
            "DELETE",
            f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}",
            headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
            json={"prefixes": [storage_key]},
        )
        resp.raise_for_status()
