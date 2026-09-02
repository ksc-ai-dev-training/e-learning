# JWT発行/検証、権限ヘルパー（詳細設計書 5.1節）
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request

from database import APP_ENV, get_pool
from settings_store import DEFAULT_GRACE_PERIOD_DAYS, get_setting_int

_DEV_SECRET = "dev-secret-change-me"
JWT_SECRET = os.environ.get("JWT_SECRET", _DEV_SECRET)
if APP_ENV == "production" and JWT_SECRET == _DEV_SECRET:
    # 開発用の既定鍵のまま本番起動するとセッションを偽造できてしまうため、起動時に落とす
    raise RuntimeError("APP_ENV=production では JWT_SECRET の設定が必須です")
JWT_EXPIRES_SECONDS = int(os.environ.get("JWT_EXPIRES_SECONDS", str(12 * 3600)))
CLI_TOKEN_EXPIRES_SECONDS = 90 * 24 * 3600  # A-62: CLIトークンは90日（詳細設計書7.1節）
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
    token_type: str = "session"
    jti: str | None = None


def issue_jwt(
    user_id: int,
    role: str,
    token_type: str = "session",
    jti: str | None = None,
    expires_seconds: int | None = None,
) -> str:
    """token_type='cli'の場合、jtiを埋め込み90日有効期限で発行する（A-62）。
    material_revisions.changed_via の判定にもtoken_typeをそのまま使う（詳細設計書7.1節）。"""
    now = int(time.time())
    expires = expires_seconds if expires_seconds is not None else JWT_EXPIRES_SECONDS
    if token_type == "cli" and jti is None:
        jti = uuid.uuid4().hex
    payload = {"sub": str(user_id), "role": role, "token_type": token_type, "iat": now, "exp": now + expires}
    if jti is not None:
        payload["jti"] = jti
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, detail="認証が必要です")


async def require_auth(request: Request) -> CurrentUser:
    token = request.cookies.get(SESSION_COOKIE)
    if token is None:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):]
    if token is None:
        raise HTTPException(401, detail="認証が必要です")
    payload = verify_jwt(token)
    if payload.get("token_type") == "cli":
        jti = payload.get("jti")
        revoked = await get_pool().fetchval(
            "SELECT 1 FROM cli_token_revocations WHERE jti = $1", jti,
        )
        if revoked:
            raise HTTPException(401, detail="失効済みのCLIトークンです")
    row = await get_pool().fetchrow(
        "SELECT id, email, name, role, is_active, picture_url FROM users WHERE id = $1",
        int(payload["sub"]),
    )
    if row is None or not row["is_active"]:
        raise HTTPException(401, detail="認証が必要です")
    return CurrentUser(
        id=row["id"], email=row["email"], name=row["name"],
        role=row["role"], picture_url=row["picture_url"],
        token_type=payload.get("token_type", "session"), jti=payload.get("jti"),
    )


def require_roles(*roles: str):
    async def checker(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(403, detail="この操作を行う権限がありません")
        return user
    return checker


ROLE_RANK = {"learner": 1, "editor": 2, "admin": 3}


async def has_active_project_role(project_id: int, user_id: int, min_role: str) -> bool:
    """プロジェクトのローカルロールを判定する（詳細設計書5.2節・5.5節「プロジェクト離任後の
    猶予期間判定」）。プロジェクト閲覧・権限判定の全呼び出し元がこれを経由し、猶予期間の挙動が
    一貫するようにする。システムadminの判定は呼び出し側で別途行う（このヘルパーはT-04
    project_membershipsの行の有無のみを見る）。

    退任（left_at設定）済みでも猶予期間内はlearner相当（閲覧・学習継続）のみ許可する。
    役職の降格自体は対象外で、admin/editorへのアクセスは退任と同時に即座に失われる
    （left_atが立った時点のroleがどうであれ、min_role != "learner"なら常に不可）。
    """
    row = await get_pool().fetchrow(
        """SELECT role, left_at FROM project_memberships
           WHERE project_id = $1 AND user_id = $2 AND status = 'active'""",
        project_id, user_id,
    )
    if row is None:
        return False
    if row["left_at"] is None:
        return ROLE_RANK[row["role"]] >= ROLE_RANK[min_role]
    if min_role != "learner":
        return False
    grace_days = await get_setting_int("project_leave_grace_period_days", DEFAULT_GRACE_PERIOD_DAYS)
    return row["left_at"] + timedelta(days=grace_days) >= datetime.now(timezone.utc)


async def check_project_role(user: CurrentUser, project_id: int, min_role: str) -> None:
    """プロジェクトのローカルロールを判定する（詳細設計書5.2節）。システムadminは常に許可。

    project_idがパスパラメータでない場合（例: A-16のようにリクエストボディに含まれる場合）に
    エンドポイント内から直接呼び出す。パスパラメータの場合は`require_project_role`を使う。
    """
    if user.role == "admin":
        return
    if not await has_active_project_role(project_id, user.id, min_role):
        raise HTTPException(403, detail="この操作を行う権限がありません")


async def is_manager_of_target_user(target_user_id: int, requester: CurrentUser) -> bool:
    """「対象者が所属するプロジェクトの管理者」判定（詳細設計書5.4節）。S-09個人学習レポート・
    A-50〜A-52で、本人以外に対象者の上長として閲覧できる相手を判定するのに使う。"""
    if requester.role == "admin":
        return True
    target_project_ids = await get_pool().fetch(
        """SELECT project_id FROM project_memberships
           WHERE user_id = $1 AND status = 'active' AND left_at IS NULL""",
        target_user_id,
    )
    for row in target_project_ids:
        if await has_active_project_role(row["project_id"], requester.id, min_role="admin"):
            return True
    return False


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


async def is_company_wide_draft_restricted(user: CurrentUser, project_id: int, is_company_wide: bool) -> bool:
    """全社公開プロジェクトの下書きを、作成者・管理者以外に見せない制限が必要かどうかを判定する。

    全社公開は全社員が自動でeditorになる特殊プロジェクトのため、下書きを他メンバーに
    意図せず見られてしまう問題があった。全社公開以外の（招待制の）プロジェクトはメンバーが
    元々限定されているため制限しない。呼び出し側で「作成者本人かどうか」も合わせて判定すること
    （このヘルパーは作成者判定を含まない）。
    """
    if not is_company_wide or user.role == "admin":
        return False
    project_role = await get_pool().fetchval(
        """SELECT role FROM project_memberships
           WHERE project_id = $1 AND user_id = $2 AND status = 'active' AND left_at IS NULL""",
        project_id, user.id,
    )
    return project_role != "admin"


def require_material_role(min_role: str):
    """教材IDから所属プロジェクトを引いてローカルロールを判定する（A-15/A-17/A-18/A-20等）。
    全社公開プロジェクトの下書きは、作成者・プロジェクト管理者・システムadmin以外は403にする
    （is_company_wide_draft_restricted、5.2節）。

    パスパラメータ `id`（教材ID）を持つルート（例: /api/materials/{id}）で使う。
    """
    async def checker(id: int, user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        row = await get_pool().fetchrow(
            """SELECT m.project_id, m.status, m.created_by, p.is_company_wide
               FROM materials m JOIN projects p ON p.id = m.project_id
               WHERE m.id = $1""",
            id,
        )
        if row is None:
            raise HTTPException(404, detail="教材が見つかりません")
        await check_project_role(user, row["project_id"], min_role)
        if row["status"] == "draft" and row["created_by"] != user.id:
            if await is_company_wide_draft_restricted(user, row["project_id"], row["is_company_wide"]):
                raise HTTPException(403, detail="この下書きを閲覧できるのは作成者とプロジェクト管理者のみです")
        return user
    return checker
