# 添付ファイルの実体保存（詳細設計書07_教材連携詳細.html 7.6節）。
# SUPABASE_URL/SUPABASE_SERVICE_KEYが未設定（ローカル開発）ならbackend/uploads/への
# ファイルシステム保存、設定済み（本番）ならSupabase Storageへ自動的に切り替える。
from __future__ import annotations

import uuid
from pathlib import Path

import httpx

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


async def create_upload_target(prefix: str, filename: str, mime_type: str) -> tuple[str, str]:
    """アップロード先を発行する（A-27）。戻り値: (storage_key, upload_url)。"""
    storage_key = _make_storage_key(prefix, filename)
    if IS_SUPABASE_CONFIGURED:
        upload_url = await _supabase_create_signed_upload_url(storage_key)
    else:
        upload_url = f"/api/uploads/{storage_key}"
    return storage_key, upload_url


async def create_download_url(storage_key: str) -> tuple[str, str | None]:
    """ダウンロードURLを発行する（A-30）。戻り値: (download_url, expires_at ISO8601 or None)。"""
    if IS_SUPABASE_CONFIGURED:
        return await _supabase_create_signed_download_url(storage_key)
    return f"/api/uploads/{storage_key}", None


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


async def _supabase_delete_object(storage_key: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.request(
            "DELETE",
            f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}",
            headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
            json={"prefixes": [storage_key]},
        )
        resp.raise_for_status()
