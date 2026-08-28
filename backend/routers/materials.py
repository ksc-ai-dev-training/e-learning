# 教材API（A-15〜A-22, A-27, A-29〜A-31, A-64, A-82）。AI機能（A-32〜A-35）は未着手。
import json
import os
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator

import storage
from auth_helpers import (
    CurrentUser,
    check_project_role,
    is_company_wide_draft_restricted,
    require_auth,
    require_material_role,
    require_project_role,
)
from database import get_pool
from markdown_render import render_material_body
from material_parser import MaterialParseError, parse_source, serialize_source

router = APIRouter(prefix="/api/projects/{project_id}/materials", tags=["materials"])
detail_router = APIRouter(prefix="/api/materials", tags=["materials"])


def _material_dict(row) -> dict:
    return {**dict(row), "tags": json.loads(row["tags"])}


@detail_router.get("")
async def search_materials(
    q: str | None = None,
    tags: str | None = None,
    project_id: int | None = None,
    required: bool | None = None,
    incomplete_only: bool = False,
    my_assignments_only: bool = False,
    page: int = 1,
    per_page: int = 20,
    user: CurrentUser = Depends(require_auth),
):
    """A-14: 公開教材の一覧・検索（学習者向け、S-03）。status='published'の教材のみを対象とし、
    下書きは一切含めない（S-14はA-21の別経路）。アーカイブ（F-30）はstatusを変更せずis_archivedフラグの
    みを立てる仕様のため、is_archived=falseも明示的に条件へ含める（当初この条件が漏れており、
    アーカイブ済み教材がS-03の一覧に表示され続ける不具合があった。2026-08-28）。6.1節のSQLを
    実装レベルへ落とし込む。

    project_idはmaterials.project_idの一致のみで判定する（F-26のプロジェクト間共有〔T-22
    material_project_shares〕は本書の時点で未実装のため、共有先への表示は対象外。実装時に追加する）。
    my_assignments_onlyは5.3節の3条件のうち、プロジェクトの現役メンバーである・個人指定の配信
    （assignments, scope_type='individual'）があるの2条件のみ判定する（3条件目の共有経由は同じ理由で対象外）。
    """
    if per_page not in (20, 50, 100):
        raise HTTPException(422, detail="per_pageは20/50/100のいずれかを指定してください")
    if page < 1:
        raise HTTPException(422, detail="pageは1以上を指定してください")

    pool = get_pool()
    conditions = ["m.status = 'published'", "m.is_archived = false"]
    params: list = []

    def add_param(value) -> str:
        params.append(value)
        return f"${len(params)}"

    if q:
        ph = add_param(f"%{q}%")
        conditions.append(
            f"(m.title ILIKE {ph} OR m.description ILIKE {ph} OR EXISTS ("
            f"SELECT 1 FROM material_nodes n WHERE n.material_id = m.id AND n.title ILIKE {ph}))"
        )
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    if tag_list:
        ph = add_param(tag_list)
        conditions.append(f"m.tags ?| {ph}::text[]")
    if project_id is not None:
        ph = add_param(project_id)
        conditions.append(f"m.project_id = {ph}")
    if required is not None:
        ph = add_param(required)
        conditions.append(
            f"EXISTS (SELECT 1 FROM assignments a WHERE a.material_id = m.id AND a.required = {ph})"
        )
    if incomplete_only:
        ph = add_param(user.id)
        conditions.append(
            f"NOT EXISTS (SELECT 1 FROM enrollment_progress ep "
            f"WHERE ep.user_id = {ph} AND ep.material_id = m.id AND ep.status = 'completed')"
        )
    if my_assignments_only:
        ph = add_param(user.id)
        conditions.append(f"""(
            EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = m.project_id
                    AND pm.user_id = {ph} AND pm.status = 'active' AND pm.left_at IS NULL)
            OR EXISTS (SELECT 1 FROM assignments ia WHERE ia.material_id = m.id
                       AND ia.scope_type = 'individual' AND ia.scope_id = {ph})
        )""")

    where_sql = " AND ".join(conditions)
    total = await pool.fetchval(f"SELECT COUNT(*) FROM materials m WHERE {where_sql}", *params)

    user_ph = add_param(user.id)
    limit_ph = add_param(per_page)
    offset_ph = add_param((page - 1) * per_page)
    rows = await pool.fetch(
        f"""SELECT m.id, m.title, m.description, m.tags, m.project_id,
                   p.name AS project_name, p.is_company_wide,
                   COALESCE(nc.chapter_count, 0) AS chapter_count,
                   COALESCE(nc.page_count, 0) AS page_count,
                   COALESCE(qc.question_count, 0) AS question_count,
                   COALESCE(qc.question_types, '[]') AS question_types,
                   EXISTS (SELECT 1 FROM assignments a WHERE a.material_id = m.id AND a.required = true) AS required,
                   COALESCE(ep.status, 'not_started') AS progress_status,
                   m.updated_at
            FROM materials m
            JOIN projects p ON p.id = m.project_id
            LEFT JOIN (
                SELECT material_id,
                       COUNT(*) FILTER (WHERE kind = 'chapter') AS chapter_count,
                       COUNT(*) FILTER (WHERE kind = 'page') AS page_count
                FROM material_nodes GROUP BY material_id
            ) nc ON nc.material_id = m.id
            LEFT JOIN (
                SELECT n.material_id, COUNT(q.id) AS question_count,
                       jsonb_agg(DISTINCT q.type) AS question_types
                FROM questions q JOIN material_nodes n ON n.id = q.node_id
                GROUP BY n.material_id
            ) qc ON qc.material_id = m.id
            LEFT JOIN enrollment_progress ep ON ep.material_id = m.id AND ep.user_id = {user_ph}
            WHERE {where_sql}
            ORDER BY m.updated_at DESC
            LIMIT {limit_ph} OFFSET {offset_ph}""",
        *params,
    )

    tag_rows = await pool.fetch(
        "SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM materials "
        "WHERE status = 'published' ORDER BY tag"
    )

    items = []
    for r in rows:
        d = dict(r)
        d["tags"] = json.loads(d["tags"])
        d["question_types"] = json.loads(d["question_types"])
        items.append(d)

    return {"items": items, "total": total, "available_tags": [t["tag"] for t in tag_rows]}


async def _fetch_tree(executor, material_id: int) -> list[dict]:
    """material_nodesをネスト済みの目次ツリー（章→小見出し→ページ）に組み立てる。
    各ページ（kind='page'）にはbody・content_kind・format・quiz_mode・pool_draw_count・questionsが乗る
    （chapter/sectionではNULL/空配列のまま実害は無い）。"""
    rows = await executor.fetch(
        """SELECT id, parent_node_id, title, kind, sort_order,
                  content_kind, format, body, quiz_mode, pool_draw_count
           FROM material_nodes
           WHERE material_id = $1 ORDER BY parent_node_id NULLS FIRST, sort_order""",
        material_id,
    )
    question_rows = await executor.fetch(
        """SELECT id, node_id, type, prompt, options, correct_answer, scoring_criteria,
                  code_language, sort_order, required, is_critical, feedback_style,
                  pool_group_id, score_unit, grading_mode
           FROM questions WHERE material_id = $1 ORDER BY node_id, sort_order""",
        material_id,
    )
    questions_by_node: dict[int, list[dict]] = {}
    for r in question_rows:
        d = dict(r)
        d["options"] = json.loads(d["options"]) if d["options"] is not None else None
        d["correct_answer"] = json.loads(d["correct_answer"]) if d["correct_answer"] is not None else None
        d["pool_group"] = d.pop("pool_group_id")
        questions_by_node.setdefault(d["node_id"], []).append(d)

    by_id = {
        r["id"]: {**dict(r), "children": [], "questions": questions_by_node.get(r["id"], [])}
        for r in rows
    }
    roots: list[dict] = []
    for r in rows:
        node = by_id[r["id"]]
        parent_id = r["parent_node_id"]
        if parent_id is None:
            roots.append(node)
        else:
            by_id[parent_id]["children"].append(node)
    return roots


async def _rebuild_source(executor, material_id: int) -> str:
    """現在のDB状態からソーステキストを再構築する（A-19・A-20・A-31共通）。"""
    material_row = await executor.fetchrow("SELECT * FROM materials WHERE id = $1", material_id)
    tree = await _fetch_tree(executor, material_id)
    return serialize_source(_material_dict(material_row), tree)


class QuestionIn(BaseModel):
    """T-10 questions（基本設計書8.3節の6種すべてに対応）。"""

    id: int | None = None
    type: Literal["single", "multi", "free_text", "code", "reorder", "score_log"]
    prompt: str = Field(min_length=1)
    options: list[str] | None = None
    correct_answer: str | list[str] | None = None
    scoring_criteria: str | None = None
    code_language: str | None = None
    required: bool = True
    is_critical: bool = False
    feedback_style: Literal["show_answer", "review_only", "hint_only"] | None = None
    pool_group: int | None = None
    score_unit: str | None = None
    grading_mode: Literal["ai", "manual"] | None = None

    @model_validator(mode="after")
    def _validate_by_type(self):
        if self.type in ("single", "multi"):
            if not self.options:
                raise ValueError(f"種別「{self.type}」には選択肢（options）が必須です")
            if self.correct_answer is None:
                raise ValueError(f"種別「{self.type}」には正解（correct_answer）が必須です")
        elif self.type == "reorder":
            if not isinstance(self.correct_answer, list) or len(self.correct_answer) < 2:
                raise ValueError("並び替え（reorder）の正解は2件以上の配列で指定してください")
        elif self.type in ("free_text", "code"):
            if not self.scoring_criteria:
                raise ValueError(f"種別「{self.type}」には採点基準（scoring_criteria）が必須です")
            if self.type == "code" and not self.code_language:
                raise ValueError("コード記述式（code）には言語（code_language）が必須です")
        elif self.type == "score_log":
            if not self.score_unit:
                raise ValueError("スコア記録（score_log）には単位（score_unit）が必須です")
            if self.is_critical:
                raise ValueError("スコア記録（score_log）にはドボン問題（is_critical）を設定できません")
        if self.grading_mode is not None and self.type not in ("free_text", "code"):
            raise ValueError("採点方式（grading_mode）は記述式・コード記述式のみ設定できます")
        return self


async def upsert_questions_for_node(
    conn, material_id: int, node_id: int, questions: list[QuestionIn]
) -> dict:
    """当該node_idの問題を送信内容で全置換する（A-20のページ全置換処理・A-31から共通で呼ぶ。
    詳細設計書07_教材連携詳細.html 7.3節「A-31と同一のロジックを適用する」に対応）。"""
    existing_ids = {
        r["id"] for r in await conn.fetch("SELECT id FROM questions WHERE node_id = $1", node_id)
    }
    seen_ids: set[int] = set()
    added = updated = 0
    for idx, q in enumerate(questions):
        options_json = json.dumps(q.options) if q.options is not None else None
        answer_json = json.dumps(q.correct_answer) if q.correct_answer is not None else None
        if q.id is not None:
            if q.id not in existing_ids:
                raise HTTPException(422, detail=f"問題ID {q.id} はこのページに存在しません")
            await conn.execute(
                """UPDATE questions SET type=$1, prompt=$2, options=$3, correct_answer=$4,
                       sort_order=$5, required=$6, is_critical=$7, feedback_style=$8,
                       pool_group_id=$9, scoring_criteria=$10, code_language=$11,
                       score_unit=$12, grading_mode=$13, updated_at=now()
                   WHERE id=$14 AND node_id=$15""",
                q.type, q.prompt, options_json, answer_json, idx,
                q.required, q.is_critical, q.feedback_style, q.pool_group,
                q.scoring_criteria, q.code_language, q.score_unit, q.grading_mode, q.id, node_id,
            )
            seen_ids.add(q.id)
            updated += 1
        else:
            new_id = await conn.fetchval(
                """INSERT INTO questions (material_id, node_id, type, prompt, options,
                       correct_answer, sort_order, required, is_critical, feedback_style, pool_group_id,
                       scoring_criteria, code_language, score_unit, grading_mode)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id""",
                material_id, node_id, q.type, q.prompt, options_json, answer_json, idx,
                q.required, q.is_critical, q.feedback_style, q.pool_group,
                q.scoring_criteria, q.code_language, q.score_unit, q.grading_mode,
            )
            seen_ids.add(new_id)
            added += 1
    deleted_ids = existing_ids - seen_ids
    if deleted_ids:
        await conn.execute("DELETE FROM questions WHERE id = ANY($1::bigint[])", list(deleted_ids))
    return {"added": added, "updated": updated, "deleted": len(deleted_ids)}


@router.get("/source")
async def list_materials_source(
    project_id: int,
    include_archived: bool = False,
    user: CurrentUser = Depends(require_project_role(min_role="editor")),
):
    """A-21: 対象プロジェクトの教材一覧（下書き含む）。S-14の一覧表示・タグ検索・構成列に使う。
    全社公開プロジェクトでは、作成者・プロジェクト管理者・システムadmin以外には他人の下書きを
    一覧にも出さない（is_company_wide_draft_restricted、5.2節）。アーカイブ済み（is_archived=true）は
    既定では除外し、S-14で「アーカイブ済み」を選んだ場合のみinclude_archived=trueで再取得して含める。"""
    pool = get_pool()
    project = await pool.fetchrow("SELECT is_company_wide FROM projects WHERE id = $1", project_id)
    restricted = await is_company_wide_draft_restricted(
        user, project_id, project["is_company_wide"] if project else False
    )

    where = "m.project_id = $1"
    params: list = [project_id]
    if not include_archived:
        where += " AND m.is_archived = false"
    if restricted:
        params.append(user.id)
        where += f" AND (m.status = 'published' OR m.created_by = ${len(params)})"

    rows = await pool.fetch(
        f"""SELECT m.id, m.title, m.status, m.is_archived, m.updated_at, m.tags,
                   COALESCE(nc.chapter_count, 0) AS chapter_count,
                   COALESCE(nc.page_count, 0) AS page_count
            FROM materials m
            LEFT JOIN (
                SELECT material_id,
                       COUNT(*) FILTER (WHERE kind = 'chapter') AS chapter_count,
                       COUNT(*) FILTER (WHERE kind = 'page') AS page_count
                FROM material_nodes
                GROUP BY material_id
            ) nc ON nc.material_id = m.id
            WHERE {where}
            ORDER BY m.updated_at DESC""",
        *params,
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
                     grading_mode, is_archived, archived_at, created_at, updated_at""",
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
                  grading_mode, is_archived, archived_at, created_at, updated_at
           FROM materials WHERE id = $1""",
        id,
    )
    if row is None:
        raise HTTPException(404, detail="教材が見つかりません")
    tree = await _fetch_tree(pool, id)
    return {**_material_dict(row), "toc": tree}


async def _require_owner_or_project_admin(pool, id: int, user: CurrentUser) -> dict:
    """アーカイブ/復元/削除は、作成者本人またはプロジェクト管理者のみ実行できる（教材一覧から
    非表示になる・完全に消える影響範囲がプロジェクトメンバー全員に及ぶため、通常の編集より一段厳しくする）。"""
    row = await pool.fetchrow(
        "SELECT project_id, created_by, is_archived, status FROM materials WHERE id = $1", id
    )
    if row is None:
        raise HTTPException(404, detail="教材が見つかりません")
    if row["created_by"] != user.id:
        await check_project_role(user, row["project_id"], min_role="admin")
    return row


@detail_router.put("/{id}/archive")
async def archive_material(id: int, user: CurrentUser = Depends(require_material_role(min_role="editor"))):
    """新規（A-84）: 教材のソフトデリート（アーカイブ）。目次・ページ・設問・添付ファイル・
    受験記録・アンケート回答は削除せず、一覧・検索（A-14/A-15/A-21）から除外するのみ。
    「復元」（A-85）でいつでも元に戻せる。下書き（status='draft'）は対象外とし、代わりに
    物理削除（A-18）を案内する（下書きは一度も公開していないため、アーカイブという
    “消せない置き場”を経由する必要が無い）。"""
    pool = get_pool()
    row = await _require_owner_or_project_admin(pool, id, user)
    if row["status"] != "published":
        raise HTTPException(
            400, detail="下書きはアーカイブできません。不要な場合は削除をご利用ください"
        )
    if row["is_archived"]:
        raise HTTPException(409, detail="この教材は既にアーカイブ済みです")
    updated = await pool.fetchrow(
        """UPDATE materials SET is_archived = true, archived_at = now(), archived_by = $2, updated_at = now()
           WHERE id = $1
           RETURNING id, project_id, title, description, tags, status, sort_order,
                     attempt_scope, retake_scope, default_feedback_style, ai_context,
                     grading_mode, is_archived, archived_at, created_at, updated_at""",
        id, user.id,
    )
    return _material_dict(updated)


@detail_router.put("/{id}/restore")
async def restore_material(id: int, user: CurrentUser = Depends(require_material_role(min_role="editor"))):
    """新規（A-85）: アーカイブ済み教材を一覧・検索に戻す。"""
    pool = get_pool()
    row = await _require_owner_or_project_admin(pool, id, user)
    if not row["is_archived"]:
        raise HTTPException(409, detail="この教材はアーカイブされていません")
    updated = await pool.fetchrow(
        """UPDATE materials SET is_archived = false, archived_at = NULL, archived_by = NULL, updated_at = now()
           WHERE id = $1
           RETURNING id, project_id, title, description, tags, status, sort_order,
                     attempt_scope, retake_scope, default_feedback_style, ai_context,
                     grading_mode, is_archived, archived_at, created_at, updated_at""",
        id,
    )
    return _material_dict(updated)


@detail_router.delete("/{id}", status_code=204)
async def delete_material(id: int, user: CurrentUser = Depends(require_material_role(min_role="editor"))):
    """A-18: 教材の物理削除。一度も公開したことのない下書き（status='draft'）のみ対象とする。
    目次・ページ・設問・添付ファイル・改訂履歴はCASCADEで削除される（受験記録・アンケート回答も
    同様だが、下書きは受講対象になり得ないため実際には発生しない）。公開済みの教材はアーカイブ
    （A-84）のみを案内し、この物理削除は400で拒否する（一度でも公開された教材は、既に受講記録が
    生じている可能性を否定できないため）。"""
    pool = get_pool()
    row = await _require_owner_or_project_admin(pool, id, user)
    if row["status"] != "draft":
        raise HTTPException(
            400, detail="公開済みの教材は削除できません。不要な場合はアーカイブをご利用ください"
        )
    await pool.execute("DELETE FROM materials WHERE id = $1", id)


def _page_path(chapter_label: str, section_title: str | None, page_title: str) -> str:
    parts = [chapter_label]
    if section_title:
        parts.append(section_title)
    parts.append(page_title)
    return " ／ ".join(parts)


@detail_router.get("/{id}/questions-summary")
async def get_questions_summary(
    id: int, user: CurrentUser = Depends(require_material_role(min_role="editor"))
):
    """新設: S-05「問題一覧」タブ用に、教材内の全設問をページ横断でフラットに集計する
    （詳細設計書10.5節）。正答率・採点待ち件数はT-13 quiz_attempts/T-14 answersを参照するが、
    S-04/S-16（受講・受験API、A-39〜A-44）が未実装のため、現状は常に「回答なし」になる
    （配線のみ先行実装。v1.26）。"""
    pool = get_pool()
    material_row = await pool.fetchrow("SELECT id FROM materials WHERE id = $1", id)
    if material_row is None:
        raise HTTPException(404, detail="教材が見つかりません")
    tree = await _fetch_tree(pool, id)

    pages_with_path: list[tuple[dict, str]] = []
    for chapter_idx, chapter in enumerate(tree):
        chapter_label = f"第{chapter_idx + 1}章"
        for child in chapter.get("children", []):
            if child["kind"] == "section":
                for page in child.get("children", []):
                    pages_with_path.append((page, _page_path(chapter_label, child["title"], page["title"])))
            else:
                pages_with_path.append((child, _page_path(chapter_label, None, child["title"])))

    question_meta: dict[int, dict] = {}
    for page, path in pages_with_path:
        for q in page.get("questions", []):
            question_meta[q["id"]] = {
                "question_id": q["id"],
                "node_id": page["id"],
                "node_path": path,
                "type": q["type"],
                "grading_mode": q.get("grading_mode"),
                "prompt": q["prompt"],
            }

    stats_by_question: dict[int, dict] = {}
    if question_meta:
        rows = await pool.fetch(
            """SELECT question_id,
                      COUNT(*) AS total_count,
                      COUNT(*) FILTER (WHERE is_correct IS NOT NULL) AS reviewed_count,
                      COUNT(*) FILTER (WHERE is_correct = true) AS correct_count,
                      COUNT(*) FILTER (WHERE is_correct IS NULL) AS pending_count
               FROM answers WHERE question_id = ANY($1::bigint[]) GROUP BY question_id""",
            list(question_meta.keys()),
        )
        stats_by_question = {r["question_id"]: dict(r) for r in rows}

    items: list[dict] = []
    for qid, meta in question_meta.items():
        stats = stats_by_question.get(
            qid, {"total_count": 0, "reviewed_count": 0, "correct_count": 0, "pending_count": 0}
        )
        is_manual = meta["grading_mode"] == "manual"
        reviewed = stats["reviewed_count"]
        accuracy_pct = round(stats["correct_count"] / reviewed * 100, 1) if reviewed > 0 else None
        items.append({
            **meta,
            "total_answers": stats["total_count"],
            "accuracy_pct": accuracy_pct,
            "pending_count": stats["pending_count"] if is_manual else 0,
        })

    # 採点待ちが多い設問ほど上、次に正答率が低い設問ほど上（回答が無い設問は末尾。元の並び順を安定ソートで維持）
    items.sort(key=lambda it: (
        -it["pending_count"],
        it["accuracy_pct"] if it["accuracy_pct"] is not None else 101,
    ))
    return {"items": items}


class MaterialUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    tags: list[str] | None = None
    status: str | None = None


@detail_router.put("/{id}")
async def update_material(
    id: int, body: MaterialUpdate, user: CurrentUser = Depends(require_material_role(min_role="editor"))
):
    """A-17: 教材メタデータの部分更新（公開判定を含む）。所属プロジェクトの変更はできない
    （プロジェクト間での教材共有はF-26で対応済みのため、破壊的なプロジェクト付け替え機能は
    設計から削除した）。公開前の内容検証は行わない。単一選択・複数選択・並び替えの正解、
    記述式・コード記述式の採点基準はQuestionInのバリデータで保存時点（A-20/A-31）に既に
    必須項目としてチェック済みのため、公開時点で改めて検証する意味が無いと判断した
    （検証しようとして初めて気づいた。2026-08-28）。"""
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        row = await get_pool().fetchrow(
            """SELECT id, project_id, title, description, tags, status, sort_order,
                      attempt_scope, retake_scope, default_feedback_style, ai_context,
                      grading_mode, is_archived, archived_at, created_at, updated_at
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
                      grading_mode, is_archived, archived_at, created_at, updated_at""",
        *values,
    )
    return _material_dict(row)


@detail_router.get("/{id}/source")
async def get_material_source(
    id: int, user: CurrentUser = Depends(require_material_role(min_role="editor"))
):
    """A-19: フロントマター付きテキスト取得（画面のMarkdown/HTMLエディタ・Claude Code共通、8.4節）。"""
    pool = get_pool()
    material_row = await pool.fetchrow("SELECT * FROM materials WHERE id = $1", id)
    if material_row is None:
        raise HTTPException(404, detail="教材が見つかりません")
    return Response(content=await _rebuild_source(pool, id), media_type="text/plain")


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
                is_page = node.kind == "page"
                node_format = node.format if is_page else None
                node_quiz_mode = node.quiz_mode if is_page else "all"
                node_pool_draw_count = node.pool_draw_count if is_page else None
                if node_quiz_mode == "pool" and (node_pool_draw_count is None or node_pool_draw_count < 1):
                    raise HTTPException(
                        422, detail=f"ページ「{node.title}」: 出題プールの抽出数（pool_draw_count）は1以上を指定してください"
                    )
                if node.node_id is not None:
                    if node.node_id not in existing_ids:
                        raise HTTPException(422, detail=f"ノードID {node.node_id} は存在しません")
                    await conn.execute(
                        """UPDATE material_nodes SET title = $1, kind = $2, sort_order = $3,
                               parent_node_id = $4, content_kind = $5, format = $6, body = $7,
                               quiz_mode = $8, pool_draw_count = $9,
                               updated_at = now() WHERE id = $10 AND material_id = $11""",
                        node.title, node.kind, node.sort_order, parent_id,
                        node.content_kind, node_format, node.body,
                        node_quiz_mode, node_pool_draw_count, node.node_id, id,
                    )
                    index_to_id[idx] = node.node_id
                    seen_ids.add(node.node_id)
                else:
                    new_id = await conn.fetchval(
                        """INSERT INTO material_nodes
                               (material_id, parent_node_id, title, kind, sort_order,
                                content_kind, format, body, quiz_mode, pool_draw_count)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id""",
                        id, parent_id, node.title, node.kind, node.sort_order,
                        node.content_kind, node_format, node.body,
                        node_quiz_mode, node_pool_draw_count,
                    )
                    index_to_id[idx] = new_id
                    seen_ids.add(new_id)
                    added_count += 1

            deleted_ids = existing_ids - seen_ids
            if deleted_ids:
                await conn.execute(
                    "DELETE FROM material_nodes WHERE id = ANY($1::bigint[])", list(deleted_ids)
                )

            # ページ（葉ノード）ごとに問題を全置換する（A-31と共通のロジック。7.3節）
            q_added = q_updated = q_deleted = 0
            for idx, node in enumerate(nodes):
                if node.kind != "page":
                    continue
                try:
                    questions_in = [QuestionIn(**q) for q in node.questions]
                except Exception as e:
                    raise HTTPException(422, detail=f"ページ「{node.title}」の問題定義が不正です: {e}")
                summary = await upsert_questions_for_node(conn, id, index_to_id[idx], questions_in)
                q_added += summary["added"]
                q_updated += summary["updated"]
                q_deleted += summary["deleted"]

            new_source = await _rebuild_source(conn, id)

            summary_parts = []
            if added_count or deleted_ids:
                summary_parts.append(f"目次構成を変更（{added_count}件追加/{len(deleted_ids)}件削除）")
            if q_added or q_updated or q_deleted:
                summary_parts.append(f"問題を{q_added}件追加/{q_updated}件更新/{q_deleted}件削除")
            change_summary = "、".join(summary_parts) or "教材情報を更新"

            await conn.execute(
                """INSERT INTO material_revisions (material_id, source_snapshot, changed_by, changed_via, change_summary)
                   VALUES ($1, $2, $3, 'web', $4)""",
                id, new_source, user.id, change_summary,
            )

    return Response(content=new_source, media_type="text/plain")


class QuestionsReplaceRequest(BaseModel):
    node_id: int
    questions: list[QuestionIn]


@detail_router.put("/{id}/questions")
async def replace_questions(
    id: int,
    body: QuestionsReplaceRequest,
    user: CurrentUser = Depends(require_material_role(min_role="editor")),
):
    """A-31: 問題の一括更新（送信内容で当該node_idの問題を全置換。5.4節）。"""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            node = await conn.fetchrow(
                "SELECT id FROM material_nodes WHERE id = $1 AND material_id = $2 AND kind = 'page'",
                body.node_id, id,
            )
            if node is None:
                raise HTTPException(404, detail="ページが見つかりません")
            summary = await upsert_questions_for_node(conn, id, body.node_id, body.questions)
            new_source = await _rebuild_source(conn, id)
            await conn.execute(
                """INSERT INTO material_revisions (material_id, source_snapshot, changed_by, changed_via, change_summary)
                   VALUES ($1, $2, $3, 'web', '問題を更新（画面操作）')""",
                id, new_source, user.id,
            )
    return {"summary": summary}


class PreviewRequest(BaseModel):
    body: str
    format: Literal["markdown", "html"]


@detail_router.post("/{id}/preview")
async def preview_material_body(
    id: int,
    body: PreviewRequest,
    user: CurrentUser = Depends(require_material_role(min_role="editor")),
):
    """A-64: S-17説明文プレビュー用。保存せずサニタイズ済みHTMLを返す（8.6節）。"""
    return {"html": render_material_body(body.body, body.format)}


class UploadUrlRequest(BaseModel):
    filename: str = Field(min_length=1)
    mime_type: str
    size_bytes: int


@detail_router.post("/{id}/attachments/upload-url")
async def create_attachment_upload_url(
    id: int,
    body: UploadUrlRequest,
    user: CurrentUser = Depends(require_material_role(min_role="editor")),
):
    """A-27: ファイルアップロード用の署名付きURLを発行する。"""
    max_mb = int(os.environ.get("MAX_ATTACHMENT_SIZE_MB", "200"))
    if body.size_bytes > max_mb * 1024 * 1024:
        raise HTTPException(413, detail=f"ファイルサイズは{max_mb}MB以内にしてください")
    storage_key, upload_url = await storage.create_upload_target(
        prefix=f"materials/{id}", filename=body.filename, mime_type=body.mime_type,
    )
    return {"upload_url": upload_url, "storage_key": storage_key}


class AttachmentCreate(BaseModel):
    node_id: int | None = None
    kind: Literal["file", "link"]
    storage_key: str | None = None
    external_url: str | None = None
    filename: str = Field(min_length=1)
    mime_type: str | None = None
    size_bytes: int | None = None

    @model_validator(mode="after")
    def _validate_kind(self):
        if self.kind == "file" and not self.storage_key:
            raise ValueError("kind='file'にはstorage_keyが必須です")
        if self.kind == "link" and not self.external_url:
            raise ValueError("kind='link'にはexternal_urlが必須です")
        return self


@detail_router.post("/{id}/attachments", status_code=201)
async def create_attachment(
    id: int,
    body: AttachmentCreate,
    user: CurrentUser = Depends(require_material_role(min_role="editor")),
):
    """A-29: 添付登録（アップロード済みファイルのメタ登録、またはkind='link'の外部リンク登録）。"""
    row = await get_pool().fetchrow(
        """INSERT INTO material_attachments
               (material_id, node_id, kind, storage_key, external_url, filename, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, node_id, kind, filename, mime_type, size_bytes, external_url, created_at""",
        id, body.node_id, body.kind, body.storage_key, body.external_url,
        body.filename, body.mime_type, body.size_bytes,
    )
    return dict(row)


@detail_router.get("/{id}/attachments/{attachment_id}/download")
async def get_attachment_download_url(
    id: int,
    attachment_id: int,
    user: CurrentUser = Depends(require_material_role(min_role="editor")),
):
    """A-30: 署名付きダウンロードURLを発行する。"""
    row = await get_pool().fetchrow(
        "SELECT kind, storage_key, external_url FROM material_attachments WHERE id = $1 AND material_id = $2",
        attachment_id, id,
    )
    if row is None:
        raise HTTPException(404, detail="添付が見つかりません")
    if row["kind"] == "link":
        return {"download_url": row["external_url"], "expires_at": None}
    url, expires_at = await storage.create_download_url(row["storage_key"])
    return {"download_url": url, "expires_at": expires_at}


@detail_router.delete("/{id}/attachments/{attachment_id}", status_code=204)
async def delete_attachment(
    id: int,
    attachment_id: int,
    user: CurrentUser = Depends(require_material_role(min_role="editor")),
):
    """A-82: 添付ファイル・リンクの削除（kind='file'はストレージ上の実体も削除する）。"""
    row = await get_pool().fetchrow(
        "SELECT kind, storage_key FROM material_attachments WHERE id = $1 AND material_id = $2",
        attachment_id, id,
    )
    if row is None:
        raise HTTPException(404, detail="添付が見つかりません")
    if row["kind"] == "file":
        await storage.delete_object(row["storage_key"])
    await get_pool().execute("DELETE FROM material_attachments WHERE id = $1", attachment_id)


@detail_router.get("/{id}/revisions")
async def list_material_revisions(
    id: int,
    page: int = 1,
    per_page: int = 20,
    user: CurrentUser = Depends(require_material_role(min_role="editor")),
):
    """A-22: 教材改訂履歴（S-05改訂履歴タブ）。新しい順。"""
    pool = get_pool()
    total = await pool.fetchval("SELECT COUNT(*) FROM material_revisions WHERE material_id = $1", id)
    rows = await pool.fetch(
        """SELECT mr.id, u.name AS changed_by_name, mr.changed_via, mr.change_summary, mr.created_at
           FROM material_revisions mr
           JOIN users u ON u.id = mr.changed_by
           WHERE mr.material_id = $1
           ORDER BY mr.created_at DESC
           LIMIT $2 OFFSET $3""",
        id, per_page, (page - 1) * per_page,
    )
    return {"items": [dict(r) for r in rows], "total": total}


@detail_router.get("/{id}/attachments")
async def list_material_attachments(
    id: int,
    node_id: int | None = None,
    user: CurrentUser = Depends(require_material_role(min_role="editor")),
):
    """A-28: 教材の添付ファイル・リンク一覧（S-05ファイル・リンクタブ）。node_id省略時は教材全体
    （各ページの添付を含む全件）を返す。S-05のこのタブは追加を行わない参照専用の一覧のため、
    4.3節の「省略時はnode_id IS NULLのみ」から変更した。ページ単位に絞り込みたい場合のみnode_idを指定する。"""
    where = "material_id = $1" + (" AND node_id = $2" if node_id is not None else "")
    params = [id] + ([node_id] if node_id is not None else [])
    rows = await get_pool().fetch(
        f"""SELECT id, node_id, kind, filename, mime_type, size_bytes, external_url, created_at
            FROM material_attachments WHERE {where} ORDER BY created_at DESC""",
        *params,
    )
    return {"items": [dict(r) for r in rows]}


class SurveyQuestionIn(BaseModel):
    """T-27 survey_questions（T-10と異なりcorrect_answerを持たない、5.28節）。"""

    id: int | None = None
    type: Literal["rating_5", "single_choice", "free_text"]
    prompt: str = Field(min_length=1)
    options: list[str] | None = None

    @model_validator(mode="after")
    def _validate_by_type(self):
        if self.type == "single_choice" and not self.options:
            raise ValueError("単一選択には選択肢（options）が必須です")
        return self


class SurveyUpsert(BaseModel):
    node_id: int | None = None  # NULLは教材全体、指定時は対象の章（kind='chapter'）
    title: str = Field(min_length=1, max_length=200)
    is_active: bool = True
    repeat_mode: Literal["once", "every_time"] = "once"
    questions: list[SurveyQuestionIn]


@detail_router.get("/{id}/surveys")
async def list_surveys(id: int, user: CurrentUser = Depends(require_material_role(min_role="editor"))):
    """A-78: 教材に設置されたアンケート一覧（教材全体分＋章ごと）を設問込みで取得する。"""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT id, node_id, title, is_active, repeat_mode FROM surveys
           WHERE material_id = $1 ORDER BY node_id NULLS FIRST""",
        id,
    )
    items = []
    for r in rows:
        qrows = await pool.fetch(
            "SELECT id, type, prompt, options FROM survey_questions WHERE survey_id = $1 ORDER BY sort_order",
            r["id"],
        )
        questions = [
            {**dict(q), "options": json.loads(q["options"]) if q["options"] is not None else None} for q in qrows
        ]
        items.append({**dict(r), "questions": questions})
    return {"items": items}


@detail_router.put("/{id}/surveys")
async def upsert_survey(
    id: int, body: SurveyUpsert, user: CurrentUser = Depends(require_material_role(min_role="editor"))
):
    """A-79: node_id（NULLは教材全体、指定時は対象の章）ごとにアンケート＋設問を設置・編集する
    （設問は全置換。T-10問題のupsert_questions_for_nodeと同じ考え方、5.28節）。"""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if body.node_id is not None:
                node = await conn.fetchrow(
                    "SELECT id FROM material_nodes WHERE id = $1 AND material_id = $2 AND kind = 'chapter'",
                    body.node_id, id,
                )
                if node is None:
                    raise HTTPException(404, detail="対象の章が見つかりません")

            existing_survey = await conn.fetchrow(
                "SELECT id FROM surveys WHERE material_id = $1 AND node_id IS NOT DISTINCT FROM $2",
                id, body.node_id,
            )
            if existing_survey:
                survey_id = existing_survey["id"]
                await conn.execute(
                    "UPDATE surveys SET title=$1, is_active=$2, repeat_mode=$3, updated_at=now() WHERE id=$4",
                    body.title, body.is_active, body.repeat_mode, survey_id,
                )
            else:
                survey_id = await conn.fetchval(
                    """INSERT INTO surveys (material_id, node_id, title, is_active, repeat_mode)
                       VALUES ($1, $2, $3, $4, $5) RETURNING id""",
                    id, body.node_id, body.title, body.is_active, body.repeat_mode,
                )

            existing_ids = {
                r["id"] for r in await conn.fetch(
                    "SELECT id FROM survey_questions WHERE survey_id = $1", survey_id
                )
            }
            seen_ids: set[int] = set()
            for idx, q in enumerate(body.questions):
                options_json = json.dumps(q.options) if q.options is not None else None
                if q.id is not None:
                    if q.id not in existing_ids:
                        raise HTTPException(422, detail=f"設問ID {q.id} はこのアンケートに存在しません")
                    await conn.execute(
                        "UPDATE survey_questions SET type=$1, prompt=$2, options=$3, sort_order=$4 WHERE id=$5",
                        q.type, q.prompt, options_json, idx, q.id,
                    )
                    seen_ids.add(q.id)
                else:
                    new_id = await conn.fetchval(
                        """INSERT INTO survey_questions (survey_id, type, prompt, options, sort_order)
                           VALUES ($1, $2, $3, $4, $5) RETURNING id""",
                        survey_id, q.type, q.prompt, options_json, idx,
                    )
                    seen_ids.add(new_id)
            deleted_ids = existing_ids - seen_ids
            if deleted_ids:
                await conn.execute(
                    "DELETE FROM survey_questions WHERE id = ANY($1::bigint[])", list(deleted_ids)
                )
    return {"id": survey_id}


@detail_router.delete("/{id}/surveys/{survey_id}", status_code=204)
async def delete_survey(
    id: int, survey_id: int, user: CurrentUser = Depends(require_material_role(min_role="editor"))
):
    """A-79（解除）: アンケートの設置を解除する（設問・回答もCASCADE削除）。"""
    row = await get_pool().fetchrow(
        "SELECT id FROM surveys WHERE id = $1 AND material_id = $2", survey_id, id
    )
    if row is None:
        raise HTTPException(404, detail="アンケートが見つかりません")
    await get_pool().execute("DELETE FROM surveys WHERE id = $1", survey_id)
