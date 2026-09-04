# A-36〜A-38 配信設定API（S-06）。詳細設計書4.4節参照。
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_helpers import CurrentUser, require_auth, require_material_role
from database import get_pool

router = APIRouter(prefix="/api", tags=["assignments"])


async def _fetch_assignment_rows(pool, material_ids: list[int]) -> dict[int, list[dict]]:
    """指定教材群の配信設定行を取得し、material_idごとにグルーピングして返す。
    scope_label（プロジェクト名または氏名）・member_count（scope_type='project'のときの
    現役メンバー数）を付与し、フロントエンドが追加のAPI呼び出し無しで一覧・要約表示できるようにする。"""
    if not material_ids:
        return {}
    rows = await pool.fetch(
        """SELECT a.id, a.material_id, a.scope_type, a.scope_id, a.required, a.due_at,
                  CASE WHEN a.scope_type = 'project' THEN sp.name ELSE su.name END AS scope_label,
                  CASE WHEN a.scope_type = 'project' THEN (
                      SELECT COUNT(*) FROM project_memberships pm2
                       WHERE pm2.project_id = a.scope_id AND pm2.status = 'active' AND pm2.left_at IS NULL
                  ) ELSE NULL END AS member_count
             FROM assignments a
             LEFT JOIN projects sp ON a.scope_type = 'project' AND sp.id = a.scope_id
             LEFT JOIN users su ON a.scope_type = 'individual' AND su.id = a.scope_id
            WHERE a.material_id = ANY($1::bigint[])
            ORDER BY a.scope_type DESC, scope_label""",
        material_ids,
    )
    grouped: dict[int, list[dict]] = {}
    for r in rows:
        grouped.setdefault(r["material_id"], []).append(dict(r))
    return grouped


@router.get("/assignments")
async def list_assignments(
    q: str | None = None,
    status: Literal["draft", "published"] | None = None,
    user: CurrentUser = Depends(require_auth),
):
    """A-36: 配信設定の一覧（S-06）。adminは全教材、それ以外は自分がローカル管理者を務める
    プロジェクトに属する教材（下書き含む）のみを対象にする。管理対象が無い一般社員は0件を返す
    （画面側で「配信設定できる教材がありません」を表示する）。"""
    pool = get_pool()
    is_system_admin = user.role == "admin"
    conditions = ["m.is_archived = false"]
    params: list = []
    if not is_system_admin:
        params.append(user.id)
        conditions.append(
            f"""EXISTS (
                SELECT 1 FROM project_memberships pm
                 WHERE pm.project_id = m.project_id AND pm.user_id = ${len(params)}
                   AND pm.role = 'admin' AND pm.status = 'active' AND pm.left_at IS NULL
            )"""
        )
    if q:
        params.append(f"%{q}%")
        conditions.append(f"m.title ILIKE ${len(params)}")
    if status:
        params.append(status)
        conditions.append(f"m.status = ${len(params)}")

    rows = await pool.fetch(
        f"""SELECT m.id, m.title, m.status, m.project_id, p.name AS project_name,
                   p.is_company_wide, m.updated_at
              FROM materials m JOIN projects p ON p.id = m.project_id
             WHERE {' AND '.join(conditions)}
             ORDER BY m.updated_at DESC""",
        *params,
    )
    assignment_map = await _fetch_assignment_rows(pool, [r["id"] for r in rows])
    items = [{**dict(r), "assignments": assignment_map.get(r["id"], [])} for r in rows]
    return {"items": items, "total": len(items)}


@router.get("/materials/{id}/assignments")
async def get_material_assignments(
    id: int, user: CurrentUser = Depends(require_material_role(min_role="admin"))
):
    """A-37: 特定教材の配信設定行を取得する（S-06編集パネルの初期表示用）。"""
    pool = get_pool()
    assignment_map = await _fetch_assignment_rows(pool, [id])
    return {"items": assignment_map.get(id, [])}


class AssignmentIn(BaseModel):
    id: int | None = None
    scope_type: Literal["project", "individual"]
    scope_id: int
    required: bool
    due_at: datetime | None = None


class AssignmentsUpdate(BaseModel):
    assignments: list[AssignmentIn]


@router.put("/materials/{id}/assignments")
async def update_material_assignments(
    id: int, body: AssignmentsUpdate, user: CurrentUser = Depends(require_material_role(min_role="admin"))
):
    """A-38: 教材の配信設定を全置換する（A-31と同じ全置換セマンティクス）。プロジェクトスコープの
    scope_idは教材自身のproject_idに固定、個人スコープのscope_idはそのプロジェクトの現役メンバーに
    限る（他プロジェクトへの一方的な配信を防ぐ、基本設計書5.9節）。全社Wikiに属する教材は
    required=trueの行を1つでも含めば拒否する（常に任意固定、5.9節「設計判断」参照）。
    pass_score_pct・retake_allowed・retake_limitはこのAPIでは扱わない（画面モックアップ
    S-06_assignment-settings.htmlに該当UIが無く、未設定時はNULLのままlearning.py側の
    既定値〔DEFAULT_PASS_SCORE_PCT等〕にフォールバックする設計のため。2026-09-01時点で整理）。"""
    pool = get_pool()
    material = await pool.fetchrow(
        """SELECT m.project_id, p.is_company_wide FROM materials m
           JOIN projects p ON p.id = m.project_id WHERE m.id = $1""",
        id,
    )
    if material is None:
        raise HTTPException(404, detail="教材が見つかりません")

    if material["is_company_wide"] and any(a.required for a in body.assignments):
        raise HTTPException(400, detail="全社Wikiの教材は必修に設定できません（常に任意です）")

    for a in body.assignments:
        if a.required and not a.due_at:
            raise HTTPException(422, detail="必修の場合は受講期限の指定が必要です")
        if a.scope_type == "project":
            if a.scope_id != material["project_id"]:
                raise HTTPException(422, detail="配信対象のプロジェクトは教材自身の所属プロジェクトに固定です")
        else:
            is_member = await pool.fetchval(
                """SELECT 1 FROM project_memberships
                    WHERE project_id = $1 AND user_id = $2 AND status = 'active' AND left_at IS NULL""",
                material["project_id"], a.scope_id,
            )
            if not is_member:
                raise HTTPException(422, detail="個人の配信対象は教材が属するプロジェクトの現役メンバーに限られます")

    async with pool.acquire() as conn:
        async with conn.transaction():
            keep_ids = [a.id for a in body.assignments if a.id is not None]
            if keep_ids:
                await conn.execute(
                    "DELETE FROM assignments WHERE material_id = $1 AND id != ALL($2::bigint[])",
                    id, keep_ids,
                )
            else:
                await conn.execute("DELETE FROM assignments WHERE material_id = $1", id)

            for a in body.assignments:
                if a.id is not None:
                    await conn.execute(
                        """UPDATE assignments SET scope_type = $1, scope_id = $2, required = $3,
                               due_at = $4, updated_at = now()
                            WHERE id = $5 AND material_id = $6""",
                        a.scope_type, a.scope_id, a.required, a.due_at, a.id, id,
                    )
                else:
                    await conn.execute(
                        """INSERT INTO assignments (material_id, scope_type, scope_id, required, due_at, created_by)
                           VALUES ($1, $2, $3, $4, $5, $6)""",
                        id, a.scope_type, a.scope_id, a.required, a.due_at, user.id,
                    )

    assignment_map = await _fetch_assignment_rows(pool, [id])
    return {"items": assignment_map.get(id, [])}
