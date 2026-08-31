# A-81/A-11 プロジェクト・メンバー一覧API。プロジェクト作成・招待等はS-11/S-12着手時に追加する。
from fastapi import APIRouter, Depends, HTTPException

from auth_helpers import ROLE_RANK, CurrentUser, check_project_role, require_auth
from database import get_pool

router = APIRouter(prefix="/api/projects", tags=["organization"])
memberships_router = APIRouter(prefix="/api/project-memberships", tags=["organization"])


@router.get("")
async def list_projects(min_role: str = "editor", user: CurrentUser = Depends(require_auth)):
    """A-81: 自分がmin_role以上のプロジェクト一覧（教材件数・メンバー数つき）。全社公開を先頭固定。
    既定はeditor（S-13教材編集：プロジェクト選択と同じ、従来どおり）。S-03（教材一覧・検索）は
    min_role='learner'を指定し、学習者としてのみ参加しているプロジェクトも含める（新規、2026-08-28）。"""
    if min_role not in ROLE_RANK:
        raise HTTPException(422, detail="min_roleが不正です")
    allowed_roles = [r for r, rank in ROLE_RANK.items() if rank >= ROLE_RANK[min_role]]
    rows = await get_pool().fetch(
        """
        SELECT
            p.id,
            p.name,
            p.is_company_wide,
            pm.role,
            COALESCE(mc.published_count, 0) AS material_published_count,
            COALESCE(mc.draft_count, 0) AS material_draft_count,
            COALESCE(memc.member_count, 0) AS member_count
        FROM projects p
        JOIN project_memberships pm
            ON pm.project_id = p.id AND pm.user_id = $1
            AND pm.status = 'active' AND pm.role = ANY($2::text[])
        LEFT JOIN (
            SELECT project_id,
                COUNT(*) FILTER (WHERE status = 'published') AS published_count,
                COUNT(*) FILTER (WHERE status = 'draft') AS draft_count
            FROM materials
            WHERE is_archived = false
            GROUP BY project_id
        ) mc ON mc.project_id = p.id
        LEFT JOIN (
            SELECT project_id, COUNT(*) AS member_count
            FROM project_memberships
            WHERE status = 'active' AND left_at IS NULL
            GROUP BY project_id
        ) memc ON memc.project_id = p.id
        WHERE p.status = 'active'
        ORDER BY p.is_company_wide DESC, p.name ASC
        """,
        user.id, allowed_roles,
    )
    return {"items": [dict(r) for r in rows]}


@memberships_router.get("")
async def list_project_memberships(
    project_id: int | None = None,
    user_id: int | None = None,
    status: str | None = None,
    user: CurrentUser = Depends(require_auth),
):
    """A-11: プロジェクトメンバー一覧。project_id指定時は対象プロジェクトの編集者以上（S-05の
    プロジェクトメンバータブが参照専用で編集者にも見せる仕様のため、4.2節の「管理者のみ」から緩和した）。
    user_id指定時は本人またはadminのみ。"""
    if project_id is None and user_id is None:
        raise HTTPException(400, detail="project_id または user_id のいずれかが必要です")
    if project_id is not None:
        await check_project_role(user, project_id, min_role="editor")
    elif user_id != user.id and user.role != "admin":
        raise HTTPException(403, detail="この操作を行う権限がありません")

    conditions = []
    params: list = []
    if project_id is not None:
        params.append(project_id)
        conditions.append(f"pm.project_id = ${len(params)}")
    if user_id is not None:
        params.append(user_id)
        conditions.append(f"pm.user_id = ${len(params)}")
    if status is not None:
        params.append(status)
        conditions.append(f"pm.status = ${len(params)}")

    rows = await get_pool().fetch(
        f"""SELECT pm.id, pm.user_id, u.name AS user_name, u.role AS global_role,
                   pm.project_id, p.name AS project_name, pm.role, pm.status,
                   pm.joined_at, pm.left_at
            FROM project_memberships pm
            JOIN users u ON u.id = pm.user_id
            JOIN projects p ON p.id = pm.project_id
            WHERE {' AND '.join(conditions)}
            ORDER BY pm.joined_at ASC""",
        *params,
    )
    return {"items": [dict(r) for r in rows]}
