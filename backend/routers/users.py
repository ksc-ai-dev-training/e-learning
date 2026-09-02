# ユーザー管理API（A-53〜A-54。S-10「管理」ユーザー管理タブ）
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_helpers import CurrentUser, require_roles
from database import get_pool

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
async def list_users(
    q: str | None = None,
    role: str | None = None,
    is_active: bool | None = None,
    page: int = 1,
    per_page: int = 20,
    user: CurrentUser = Depends(require_roles("admin")),
):
    """A-53: ユーザー一覧（システムadmin専用）。プロジェクトのローカル管理者向けの招待候補検索は
    別途軽量なA-90（member-candidates）を使う（本APIとは権限・用途が異なるため使い分ける）。"""
    if per_page not in (20, 50, 100):
        raise HTTPException(422, detail="per_pageは20/50/100のいずれかを指定してください")
    if page < 1:
        raise HTTPException(422, detail="pageは1以上を指定してください")

    pool = get_pool()
    conditions: list[str] = []
    params: list = []

    def add_param(value) -> str:
        params.append(value)
        return f"${len(params)}"

    if q:
        ph = add_param(f"%{q}%")
        conditions.append(f"(name ILIKE {ph} OR email ILIKE {ph})")
    if role is not None:
        ph = add_param(role)
        conditions.append(f"role = {ph}")
    if is_active is not None:
        ph = add_param(is_active)
        conditions.append(f"is_active = {ph}")
    where_sql = " AND ".join(conditions) if conditions else "TRUE"

    total = await pool.fetchval(f"SELECT COUNT(*) FROM users WHERE {where_sql}", *params)
    limit_ph = add_param(per_page)
    offset_ph = add_param((page - 1) * per_page)
    rows = await pool.fetch(
        f"""SELECT id, name, email, role, is_active, created_at
            FROM users WHERE {where_sql}
            ORDER BY name LIMIT {limit_ph} OFFSET {offset_ph}""",
        *params,
    )
    return {"items": [dict(r) for r in rows], "total": total}


class UserUpdate(BaseModel):
    role: Literal["member", "admin"] | None = None
    is_active: bool | None = None


@router.put("/{id}")
async def update_user(id: int, body: UserUpdate, user: CurrentUser = Depends(require_roles("admin"))):
    """A-54: ロール変更・有効/無効切替。自分自身のadmin降格・無効化は拒否する（画面設計書4.12節）。
    設計書には明記が無いが、システムadminが実質1人しかいない状態でその最後の1人を降格・無効化
    できてしまうと、以後システム全体でadminが不在になり管理機能自体が使えなくなるため、プロジェクトの
    「唯一の管理者は降格・削除不可」（organization.py）と同じ考え方でこのガードも追加した
    （ユーザー確認済み、2026-09-02）。"""
    demoting_or_deactivating = (body.role is not None and body.role != "admin") or body.is_active is False
    if id == user.id and demoting_or_deactivating:
        raise HTTPException(400, detail="自分自身の権限は変更できません")

    pool = get_pool()
    existing = await pool.fetchrow("SELECT role, is_active FROM users WHERE id = $1", id)
    if existing is None:
        raise HTTPException(404, detail="ユーザーが見つかりません")

    if existing["role"] == "admin" and existing["is_active"] and demoting_or_deactivating:
        admin_count = await pool.fetchval(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = true"
        )
        if admin_count <= 1:
            raise HTTPException(400, detail="システム管理者が不在になるため、この操作はできません")

    row = await pool.fetchrow(
        """UPDATE users SET role = COALESCE($1, role), is_active = COALESCE($2, is_active), updated_at = now()
           WHERE id = $3
           RETURNING id, name, email, role, is_active, created_at""",
        body.role, body.is_active, id,
    )
    return dict(row)
