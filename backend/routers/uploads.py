# ローカル開発専用のファイル実体保存エンドポイント（storage.py参照。詳細設計書07_教材連携詳細.html 7.6節）。
# 本番（SUPABASE_URL設定時）はA-27/A-30がSupabase Storageの署名付きURLを直接返すため、このルートは使われない。
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

import storage
from auth_helpers import CurrentUser, require_auth

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.put("/{storage_key:path}")
async def put_upload(
    storage_key: str, request: Request, user: CurrentUser = Depends(require_auth)
):
    if storage.IS_SUPABASE_CONFIGURED:
        raise HTTPException(404)
    data = await request.body()
    try:
        storage.save_local_file(storage_key, data)
    except ValueError:
        raise HTTPException(400, detail="不正なパスです")
    return {"ok": True}


@router.get("/{storage_key:path}")
async def get_upload(storage_key: str, user: CurrentUser = Depends(require_auth)):
    if storage.IS_SUPABASE_CONFIGURED:
        raise HTTPException(404)
    try:
        data = storage.read_local_file(storage_key)
    except ValueError:
        raise HTTPException(400, detail="不正なパスです")
    except FileNotFoundError:
        raise HTTPException(404, detail="ファイルが見つかりません")
    return Response(content=data, media_type="application/octet-stream")
