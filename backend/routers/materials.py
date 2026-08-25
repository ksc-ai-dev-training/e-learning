# A-21 教材一覧（source）API。他の教材系APIはS-05/S-17着手時に追加する。
from fastapi import APIRouter, Depends

from auth_helpers import CurrentUser, require_project_role
from database import get_pool

router = APIRouter(prefix="/api/projects/{project_id}/materials", tags=["materials"])


@router.get("/source")
async def list_materials_source(
    project_id: int, user: CurrentUser = Depends(require_project_role(min_role="editor"))
):
    """A-21: 対象プロジェクトの教材一覧（下書き含む）。S-14の一覧表示に使う。"""
    rows = await get_pool().fetch(
        """SELECT id, title, status, updated_at FROM materials
           WHERE project_id = $1 ORDER BY updated_at DESC""",
        project_id,
    )
    return {"items": [dict(r) for r in rows]}
