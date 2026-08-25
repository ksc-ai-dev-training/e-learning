# A-81 プロジェクト一覧API。他のプロジェクト・メンバー・教材共有APIはS-11/S-12着手時に追加する。
from fastapi import APIRouter, Depends

from auth_helpers import CurrentUser, require_auth
from database import get_pool

router = APIRouter(prefix="/api/projects", tags=["organization"])


@router.get("")
async def list_projects(user: CurrentUser = Depends(require_auth)):
    """A-81: 自分がeditor以上のプロジェクト一覧（教材件数・メンバー数つき）。全社公開を先頭固定。"""
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
            AND pm.status = 'active' AND pm.role IN ('editor', 'admin')
        LEFT JOIN (
            SELECT project_id,
                COUNT(*) FILTER (WHERE status = 'published') AS published_count,
                COUNT(*) FILTER (WHERE status = 'draft') AS draft_count
            FROM materials
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
        user.id,
    )
    return {"items": [dict(r) for r in rows]}
