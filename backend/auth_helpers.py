# JWT発行/検証、権限ヘルパー（詳細設計書 5.1節）
import os
import time
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request

from database import APP_ENV, get_pool

_DEV_SECRET = "dev-secret-change-me"
JWT_SECRET = os.environ.get("JWT_SECRET", _DEV_SECRET)
if APP_ENV == "production" and JWT_SECRET == _DEV_SECRET:
    # 開発用の既定鍵のまま本番起動するとセッションを偽造できてしまうため、起動時に落とす
    raise RuntimeError("APP_ENV=production では JWT_SECRET の設定が必須です")
JWT_EXPIRES_SECONDS = int(os.environ.get("JWT_EXPIRES_SECONDS", str(12 * 3600)))
SESSION_COOKIE = "manabi_session"
# 本番（HTTPS）ではセッションCookieに Secure 属性を付与する
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1" if APP_ENV == "production" else "0") == "1"


@dataclass
class CurrentUser:
    id: int
    email: str
    name: str
    role: str
    picture_url: str | None


def issue_jwt(user_id: int, role: str) -> str:
    now = int(time.time())
    payload = {"sub": str(user_id), "role": role, "iat": now, "exp": now + JWT_EXPIRES_SECONDS}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, detail="認証が必要です")


async def require_auth(request: Request) -> CurrentUser:
    token = request.cookies.get(SESSION_COOKIE)
    if token is None:
        raise HTTPException(401, detail="認証が必要です")
    payload = verify_jwt(token)
    row = await get_pool().fetchrow(
        "SELECT id, email, name, role, is_active, picture_url FROM users WHERE id = $1",
        int(payload["sub"]),
    )
    if row is None or not row["is_active"]:
        raise HTTPException(401, detail="認証が必要です")
    return CurrentUser(
        id=row["id"], email=row["email"], name=row["name"],
        role=row["role"], picture_url=row["picture_url"],
    )


def require_roles(*roles: str):
    async def checker(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(403, detail="この操作を行う権限がありません")
        return user
    return checker


ROLE_RANK = {"learner": 1, "editor": 2, "admin": 3}


async def check_project_role(user: CurrentUser, project_id: int, min_role: str) -> None:
    """プロジェクトのローカルロールを判定する（詳細設計書5.2節）。システムadminは常に許可。

    project_idがパスパラメータでない場合（例: A-16のようにリクエストボディに含まれる場合）に
    エンドポイント内から直接呼び出す。パスパラメータの場合は`require_project_role`を使う。
    """
    if user.role == "admin":
        return
    row = await get_pool().fetchrow(
        """SELECT role FROM project_memberships
           WHERE project_id = $1 AND user_id = $2
             AND status = 'active' AND left_at IS NULL""",
        project_id, user.id,
    )
    if row is None or ROLE_RANK[row["role"]] < ROLE_RANK[min_role]:
        raise HTTPException(403, detail="この操作を行う権限がありません")


def require_project_role(min_role: str):
    """プロジェクトのローカルロールを判定する（詳細設計書5.2節）。

    パスパラメータ `project_id` を持つルート（例: /api/projects/{project_id}/...）で
    `Depends(require_project_role(min_role="editor"))` のように使う。
    project_idはFastAPIがパスから自動解決する。
    """
    async def checker(project_id: int, user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        await check_project_role(user, project_id, min_role)
        return user
    return checker


def require_material_role(min_role: str):
    """教材IDから所属プロジェクトを引いてローカルロールを判定する（A-15/A-17/A-18/A-20等）。

    パスパラメータ `id`（教材ID）を持つルート（例: /api/materials/{id}）で使う。
    """
    async def checker(id: int, user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        row = await get_pool().fetchrow("SELECT project_id FROM materials WHERE id = $1", id)
        if row is None:
            raise HTTPException(404, detail="教材が見つかりません")
        await check_project_role(user, row["project_id"], min_role)
        return user
    return checker
