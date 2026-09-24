# ローカル開発専用のファイル実体保存エンドポイント（storage.py参照。詳細設計書07_教材連携詳細.html 7.6節）。
# 本番（SUPABASE_URL設定時）はA-27/A-30がSupabase Storageの署名付きURLを直接返すため、このルートは使われない。
import mimetypes

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

import storage
from auth_helpers import CurrentUser, require_auth

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


def _check_signature(storage_key: str, expires: int | None, sig: str | None) -> None:
    """expires/sigクエリを検証する。本番のSupabase署名付きURL（対象storage_key限定・
    600秒で失効）と同等の保護をローカル開発でも持たせる（2026-09-02、コードレビューで
    発見・修正。以前はrequire_authのみで、storage_keyさえ知っていれば無期限に閲覧・
    上書きできてしまっていた）。"""
    if expires is None or sig is None or not storage.verify_local_signed_query(storage_key, expires, sig):
        raise HTTPException(403, detail="URLの有効期限が切れているか、署名が不正です")


@router.put("/{storage_key:path}")
async def put_upload(
    storage_key: str,
    request: Request,
    expires: int | None = None,
    sig: str | None = None,
    user: CurrentUser = Depends(require_auth),
):
    if storage.IS_SUPABASE_CONFIGURED:
        raise HTTPException(404)
    _check_signature(storage_key, expires, sig)
    data = await request.body()
    try:
        storage.save_local_file(storage_key, data)
    except ValueError:
        raise HTTPException(400, detail="不正なパスです")
    return {"ok": True}


@router.get("/{storage_key:path}")
async def get_upload(
    storage_key: str,
    expires: int | None = None,
    sig: str | None = None,
    user: CurrentUser = Depends(require_auth),
):
    if storage.IS_SUPABASE_CONFIGURED:
        raise HTTPException(404)
    _check_signature(storage_key, expires, sig)
    try:
        data = storage.read_local_file(storage_key)
    except ValueError:
        raise HTTPException(400, detail="不正なパスです")
    except FileNotFoundError:
        raise HTTPException(404, detail="ファイルが見つかりません")
    # 常にapplication/octet-streamで返すと、ブラウザがPDF等をプレビュー表示できずダウンロードに
    # フォールバックしてしまう（20260919_Manabi改善提案.html #2、PDFビューア表示機能で発覚。
    # 2026-09-24修正）。storage_keyは_make_storage_key（storage.py）でアップロード時の拡張子を
    # 保ったまま採番しているため、拡張子から実際のMIMEタイプを復元できる。本番（Supabase Storage）は
    # アップロード時にブラウザがFileのtypeを自動でContent-Typeとして送るため、この問題は無い
    # （ローカル開発専用のこの経路だけの不具合）。
    media_type = mimetypes.guess_type(storage_key)[0] or "application/octet-stream"
    return Response(content=data, media_type=media_type)
