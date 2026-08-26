# 教材API（A-15〜A-17, A-20, A-21）。問題・添付・AI機能等はS-17着手時に追加する。
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth_helpers import (
    CurrentUser,
    check_project_role,
    require_auth,
    require_material_role,
    require_project_role,
)
from database import get_pool
from material_parser import MaterialParseError, parse_source, serialize_source

router = APIRouter(prefix="/api/projects/{project_id}/materials", tags=["materials"])
detail_router = APIRouter(prefix="/api/materials", tags=["materials"])


def _material_dict(row) -> dict:
    return {**dict(row), "tags": json.loads(row["tags"])}


async def _fetch_tree(executor, material_id: int) -> list[dict]:
    """material_nodesをネスト済みの目次ツリー（章→小見出し→ページ）に組み立てる。"""
    rows = await executor.fetch(
        """SELECT id, parent_node_id, title, kind, sort_order FROM material_nodes
           WHERE material_id = $1 ORDER BY parent_node_id NULLS FIRST, sort_order""",
        material_id,
    )
    by_id = {r["id"]: {**dict(r), "children": []} for r in rows}
    roots: list[dict] = []
    for r in rows:
        node = by_id[r["id"]]
        parent_id = r["parent_node_id"]
        if parent_id is None:
            roots.append(node)
        else:
            by_id[parent_id]["children"].append(node)
    return roots


@router.get("/source")
async def list_materials_source(
    project_id: int, user: CurrentUser = Depends(require_project_role(min_role="editor"))
):
    """A-21: 対象プロジェクトの教材一覧（下書き含む）。S-14の一覧表示・タグ検索に使う。"""
    rows = await get_pool().fetch(
        """SELECT id, title, status, updated_at, tags FROM materials
           WHERE project_id = $1 ORDER BY updated_at DESC""",
        project_id,
    )
    return {"items": [{**dict(r), "tags": json.loads(r["tags"])} for r in rows]}


class MaterialCreate(BaseModel):
    project_id: int | None = None
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    tags: list[str] = []


@detail_router.post("", status_code=201)
async def create_material(body: MaterialCreate, user: CurrentUser = Depends(require_auth)):
    """A-16: 教材の新規作成。project_id省略時は「全社公開」を既定にする（基本設計書5.26節）。"""
    project_id = body.project_id
    if project_id is None:
        project_id = await get_pool().fetchval(
            "SELECT id FROM projects WHERE is_company_wide = true LIMIT 1"
        )
    await check_project_role(user, project_id, min_role="editor")
    row = await get_pool().fetchrow(
        """INSERT INTO materials (project_id, title, description, tags, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, project_id, title, description, tags, status, sort_order,
                     attempt_scope, retake_scope, default_feedback_style, ai_context,
                     grading_mode, created_at, updated_at""",
        project_id, body.title, body.description, json.dumps(body.tags), user.id,
    )
    return _material_dict(row)


@detail_router.get("/{id}")
async def get_material(id: int, user: CurrentUser = Depends(require_material_role(min_role="editor"))):
    """A-15: 教材メタ＋目次ツリー。現状は編集権限保持者のみ（受講対象者向けの公開閲覧はS-04着手時に追加）。"""
    pool = get_pool()
    row = await pool.fetchrow(
        """SELECT id, project_id, title, description, tags, status, sort_order,
                  attempt_scope, retake_scope, default_feedback_style, ai_context,
                  grading_mode, created_at, updated_at
           FROM materials WHERE id = $1""",
        id,
    )
    if row is None:
        raise HTTPException(404, detail="教材が見つかりません")
    tree = await _fetch_tree(pool, id)
    return {**_material_dict(row), "toc": tree}


class MaterialUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    tags: list[str] | None = None
    project_id: int | None = None
    status: str | None = None


@detail_router.put("/{id}")
async def update_material(
    id: int, body: MaterialUpdate, user: CurrentUser = Depends(require_material_role(min_role="editor"))
):
    """A-17: 教材メタデータの部分更新。project_id変更時は変更後プロジェクトの編集権限も必要。"""
    updates = body.model_dump(exclude_unset=True)
    if "project_id" in updates and updates["project_id"] is not None:
        await check_project_role(user, updates["project_id"], min_role="editor")
    if not updates:
        row = await get_pool().fetchrow(
            """SELECT id, project_id, title, description, tags, status, sort_order,
                      attempt_scope, retake_scope, default_feedback_style, ai_context,
                      grading_mode, created_at, updated_at
               FROM materials WHERE id = $1""",
            id,
        )
        return _material_dict(row)

    set_clauses = []
    values = []
    for key, value in updates.items():
        if key == "tags":
            value = json.dumps(value)
        values.append(value)
        set_clauses.append(f"{key} = ${len(values)}")
    values.append(id)
    row = await get_pool().fetchrow(
        f"""UPDATE materials SET {', '.join(set_clauses)}, updated_at = now()
            WHERE id = ${len(values)}
            RETURNING id, project_id, title, description, tags, status, sort_order,
                      attempt_scope, retake_scope, default_feedback_style, ai_context,
                      grading_mode, created_at, updated_at""",
        *values,
    )
    return _material_dict(row)


@detail_router.put("/{id}/source")
async def put_material_source(
    id: int, request: Request, user: CurrentUser = Depends(require_material_role(min_role="editor"))
):
    """A-20: 目次構造の全置換保存（詳細設計書7.3節）。目次ツリー編集（章・小見出しの追加/削除/並び替え）は
    このAPIを都度呼ぶ形にする（Claude Code連携A-19/A-20と同じ書き込み経路。7章参照）。"""
    text = (await request.body()).decode("utf-8")
    try:
        meta, nodes = parse_source(text)
    except MaterialParseError as e:
        raise HTTPException(422, detail=e.detail)

    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            material_row = await conn.fetchrow("SELECT * FROM materials WHERE id = $1", id)
            if material_row is None:
                raise HTTPException(404, detail="教材が見つかりません")
            incoming_project_id = meta.get("project_id")
            if incoming_project_id is not None and incoming_project_id != material_row["project_id"]:
                raise HTTPException(400, detail="プロジェクトの付け替えはA-17を使用してください")

            await conn.execute(
                """UPDATE materials SET
                       title = $1, description = $2, tags = $3, status = $4, sort_order = $5,
                       attempt_scope = $6, retake_scope = $7, default_feedback_style = $8,
                       ai_context = $9, grading_mode = $10, updated_at = now()
                   WHERE id = $11""",
                meta.get("title", material_row["title"]),
                meta.get("description", material_row["description"]),
                json.dumps(meta.get("tags") or []),
                meta.get("status", material_row["status"]),
                meta.get("sort_order", material_row["sort_order"]),
                meta.get("attempt_scope", material_row["attempt_scope"]),
                meta.get("retake_scope", material_row["retake_scope"]),
                meta.get("default_feedback_style", material_row["default_feedback_style"]),
                meta.get("ai_context", material_row["ai_context"]),
                meta.get("grading_mode", material_row["grading_mode"]),
                id,
            )

            existing_ids = {r["id"] for r in await conn.fetch(
                "SELECT id FROM material_nodes WHERE material_id = $1", id
            )}
            index_to_id: dict[int, int] = {}
            seen_ids: set[int] = set()
            added_count = 0
            for idx, node in enumerate(nodes):
                parent_id = index_to_id[node.parent_ref] if node.parent_ref is not None else None
                if node.node_id is not None:
                    if node.node_id not in existing_ids:
                        raise HTTPException(422, detail=f"ノードID {node.node_id} は存在しません")
                    await conn.execute(
                        """UPDATE material_nodes SET title = $1, kind = $2, sort_order = $3,
                               parent_node_id = $4, updated_at = now() WHERE id = $5 AND material_id = $6""",
                        node.title, node.kind, node.sort_order, parent_id, node.node_id, id,
                    )
                    index_to_id[idx] = node.node_id
                    seen_ids.add(node.node_id)
                else:
                    new_id = await conn.fetchval(
                        """INSERT INTO material_nodes (material_id, parent_node_id, title, kind, sort_order)
                           VALUES ($1, $2, $3, $4, $5) RETURNING id""",
                        id, parent_id, node.title, node.kind, node.sort_order,
                    )
                    index_to_id[idx] = new_id
                    seen_ids.add(new_id)
                    added_count += 1

            deleted_ids = existing_ids - seen_ids
            if deleted_ids:
                await conn.execute(
                    "DELETE FROM material_nodes WHERE id = ANY($1::bigint[])", list(deleted_ids)
                )

            updated_material = await conn.fetchrow("SELECT * FROM materials WHERE id = $1", id)
            tree = await _fetch_tree(conn, id)
            new_source = serialize_source(_material_dict(updated_material), tree)

            summary_parts = []
            if added_count or deleted_ids:
                summary_parts.append(f"目次構成を変更（{added_count}件追加/{len(deleted_ids)}件削除）")
            change_summary = "、".join(summary_parts) or "教材情報を更新"

            await conn.execute(
                """INSERT INTO material_revisions (material_id, source_snapshot, changed_by, changed_via, change_summary)
                   VALUES ($1, $2, $3, 'web', $4)""",
                id, new_source, user.id, change_summary,
            )

    return Response(content=new_source, media_type="text/plain")
