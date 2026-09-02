# 個人学習レポートAPI（A-50〜A-52。S-09、F-22 AI個人フィードバック）。
import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException

import ai_client
from auth_helpers import CurrentUser, is_manager_of_target_user, require_auth
from database import get_pool

router = APIRouter(prefix="/api/reports/personal", tags=["reports"])
logger = logging.getLogger("manabi.reports")


async def _require_report_access(user_id: int, user: CurrentUser) -> None:
    """本人、または対象者が所属するプロジェクトの管理者・システムadminのみ許可する（詳細設計書5.4節）。"""
    if user.id == user_id:
        return
    if not await is_manager_of_target_user(user_id, user):
        raise HTTPException(403, detail="この学習レポートを閲覧する権限がありません")


async def _aggregate_personal_report(user_id: int) -> dict:
    """A-50の集計本体。サマリー（受講済み教材数・必修受講完了率・直近受講日）と学習履歴
    （教材ごとの直近のgraded試行の結果）を返す（詳細設計書4.7節のレスポンス形状）。

    「正答率」は設問0件の試行（説明文のみのページ・スコア記録のみの教材）が
    `_recompute_attempt_result`の仕様上score_pct=100扱いになる（learning.py参照）ため、
    平均や履歴の集計に含めると実態より高く出てしまう。そのため、gradable（score_log以外）の
    設問を1問以上含むgraded試行のみを対象にする（ユーザー指摘、2026-09-02）。"""
    pool = get_pool()

    completed_count = await pool.fetchval(
        "SELECT COUNT(*) FROM enrollment_progress WHERE user_id = $1 AND status = 'completed'",
        user_id,
    )
    # 必修受講完了率: A-39（マイ学習）のrequired_completion_pctと同じ考え方（5.3節の受講対象判定）を
    # 任意のuser_id向けに一般化したもの。対象の必修教材が1件も無い場合は0%とする（A-39と揃える）。
    required_counts = await pool.fetchrow(
        """SELECT
               COUNT(*) AS total_required,
               COUNT(*) FILTER (
                   WHERE EXISTS (SELECT 1 FROM enrollment_progress ep
                                  WHERE ep.material_id = m.id AND ep.user_id = $1 AND ep.status = 'completed')
               ) AS completed_required
           FROM materials m
           WHERE m.status = 'published' AND m.is_archived = false
             AND EXISTS (SELECT 1 FROM assignments a WHERE a.material_id = m.id AND a.required = true
                          AND ((a.scope_type = 'project' AND a.scope_id = m.project_id)
                               OR (a.scope_type = 'individual' AND a.scope_id = $1)))
             AND (
               EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = m.project_id
                       AND pm.user_id = $1 AND pm.status = 'active' AND pm.left_at IS NULL)
               OR EXISTS (SELECT 1 FROM assignments ia WHERE ia.material_id = m.id
                          AND ia.scope_type = 'individual' AND ia.scope_id = $1)
             )""",
        user_id,
    )
    total_required = required_counts["total_required"]
    incomplete_required_count = total_required - required_counts["completed_required"]
    required_completion_pct = (
        round(100 * required_counts["completed_required"] / total_required) if total_required else 0
    )
    last_activity_at = await pool.fetchval(
        "SELECT MAX(updated_at) FROM enrollment_progress WHERE user_id = $1", user_id
    )

    history_rows = await pool.fetch(
        """SELECT m.id AS material_id, m.title AS material_title, ep.completed_at,
                  latest.score_pct, latest.passed
           FROM enrollment_progress ep
           JOIN materials m ON m.id = ep.material_id
           LEFT JOIN LATERAL (
               SELECT qa.score_pct, qa.passed FROM quiz_attempts qa
                WHERE qa.material_id = ep.material_id AND qa.user_id = ep.user_id
                  AND qa.mode = 'graded' AND qa.submitted_at IS NOT NULL
                  AND EXISTS (SELECT 1 FROM answers a JOIN questions q ON q.id = a.question_id
                               WHERE a.attempt_id = qa.id AND q.type != 'score_log')
                ORDER BY qa.submitted_at DESC LIMIT 1
           ) latest ON true
           WHERE ep.user_id = $1
           ORDER BY ep.updated_at DESC""",
        user_id,
    )

    return {
        "summary": {
            "completed_material_count": completed_count,
            "incomplete_required_count": incomplete_required_count,
            "required_completion_pct": required_completion_pct,
            "last_activity_at": last_activity_at,
        },
        "history": [
            {
                "material_id": r["material_id"],
                "material_title": r["material_title"],
                "completed_at": r["completed_at"],
                "score_pct": float(r["score_pct"]) if r["score_pct"] is not None else None,
                "passed": r["passed"],
            }
            for r in history_rows
        ],
    }


@router.get("/{user_id}")
async def get_personal_report(user_id: int, user: CurrentUser = Depends(require_auth)):
    """A-50: 個人学習レポート（対象者情報・サマリー・学習履歴。画面項目定義10.8節「対象者情報」に
    対応するため、API詳細設計書の{"summary","history"}に加えtarget_userも返す）。"""
    await _require_report_access(user_id, user)
    pool = get_pool()
    target = await pool.fetchrow("SELECT id, name, email FROM users WHERE id = $1", user_id)
    if target is None:
        raise HTTPException(404, detail="対象のユーザーが見つかりません")
    project_rows = await pool.fetch(
        """SELECT p.name FROM project_memberships pm JOIN projects p ON p.id = pm.project_id
           WHERE pm.user_id = $1 AND pm.status = 'active' AND pm.left_at IS NULL
           ORDER BY p.is_company_wide DESC, p.name ASC""",
        user_id,
    )
    report = await _aggregate_personal_report(user_id)
    return {
        "target_user": {
            "id": target["id"],
            "name": target["name"],
            "email": target["email"],
            "project_names": [r["name"] for r in project_rows],
        },
        **report,
    }


async def _aggregate_tag_stats(user_id: int) -> list[dict]:
    """教材タグ別の正答率集計（F-22プロンプト用、9.4節「個人が特定できる情報を送らない」方針の
    とおりuser_idはSQLの絞り込みにのみ使い、氏名等は一切含めない）。設問0件の試行（score_pct=100
    扱いになる、_aggregate_personal_report参照）は除外する。"""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT jsonb_array_elements_text(m.tags) AS tag, qa.score_pct
           FROM quiz_attempts qa
           JOIN materials m ON m.id = qa.material_id
           WHERE qa.user_id = $1 AND qa.mode = 'graded' AND qa.submitted_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM answers a JOIN questions q ON q.id = a.question_id
                          WHERE a.attempt_id = qa.id AND q.type != 'score_log')""",
        user_id,
    )
    by_tag: dict[str, list[float]] = {}
    for r in rows:
        by_tag.setdefault(r["tag"], []).append(float(r["score_pct"]))
    return [
        {"tag": tag, "avg_score_pct": sum(scores) / len(scores), "attempt_count": len(scores)}
        for tag, scores in by_tag.items()
    ]


async def _aggregate_candidate_materials(user_id: int, limit: int = 20) -> list[dict]:
    """AIへおすすめ候補として渡す、受講対象の公開教材のうち「まだ完了していない」または
    「完了はしているが直近の受験（graded）が不合格だった」もの（5.3節の受講対象判定＋反復推奨）。
    attempt_scope='material'の教材はページ閲覧のみで完了扱いになり得るため、完了済みでも
    不合格なら反復推奨の候補として残す（ユーザー指摘、2026-09-02）。"""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT m.id, m.title, m.tags FROM materials m
           LEFT JOIN enrollment_progress ep ON ep.material_id = m.id AND ep.user_id = $1
           LEFT JOIN LATERAL (
               SELECT passed FROM quiz_attempts qa
                WHERE qa.material_id = m.id AND qa.user_id = $1
                  AND qa.mode = 'graded' AND qa.submitted_at IS NOT NULL
                ORDER BY qa.submitted_at DESC LIMIT 1
           ) latest ON true
           WHERE m.status = 'published' AND m.is_archived = false
             AND (
               EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = m.project_id
                       AND pm.user_id = $1 AND pm.status = 'active' AND pm.left_at IS NULL)
               OR EXISTS (SELECT 1 FROM assignments ia WHERE ia.material_id = m.id
                          AND ia.scope_type = 'individual' AND ia.scope_id = $1)
             )
             AND (ep.status IS DISTINCT FROM 'completed' OR latest.passed = false)
           ORDER BY m.updated_at DESC
           LIMIT $2""",
        user_id, limit,
    )
    return [{"id": r["id"], "title": r["title"], "tags": json.loads(r["tags"])} for r in rows]


async def run_ai_personal_feedback_job(feedback_id: int, user_id: int) -> None:
    """非同期ジョブ本体（詳細設計書8.2節）。失敗時はcontentをNULLのまま残し、行自体は削除しない。"""
    pool = get_pool()
    try:
        report = await _aggregate_personal_report(user_id)
        tag_stats = await _aggregate_tag_stats(user_id)
        candidates = await _aggregate_candidate_materials(user_id)
        result = await ai_client.generate_personal_feedback(
            summary_stats=report["summary"], tag_stats=tag_stats, candidate_materials=candidates, user_id=user_id
        )
        candidate_ids = {c["id"] for c in candidates}
        content = {
            "comment": result.get("comment", ""),
            "weak_areas": list(result.get("weak_areas", [])),
            "recommended_material_ids": [
                mid for mid in result.get("recommended_material_ids", []) if mid in candidate_ids
            ],
        }
        await pool.execute(
            "UPDATE ai_personal_feedback SET content = $1 WHERE id = $2 AND content IS NULL",
            json.dumps(content), feedback_id,
        )
    except Exception:
        logger.exception("AI個人フィードバックのジョブに失敗しました（feedback_id=%s）", feedback_id)


@router.post("/{user_id}/ai-feedback", status_code=202)
async def request_personal_ai_feedback(user_id: int, user: CurrentUser = Depends(require_auth)):
    """A-51: AI個人フィードバックの生成をリクエストする（非同期。202を返しジョブをバックグラウンド起動）。"""
    await _require_report_access(user_id, user)
    row = await get_pool().fetchrow(
        "INSERT INTO ai_personal_feedback (user_id) VALUES ($1) RETURNING id", user_id
    )
    asyncio.create_task(run_ai_personal_feedback_job(row["id"], user_id))
    return {"status": "pending", "job_id": row["id"]}


@router.get("/{user_id}/ai-feedback")
async def get_personal_ai_feedback(user_id: int, user: CurrentUser = Depends(require_auth)):
    """A-52: 直近のAI個人フィードバックを取得する。未完了（content未設定）または未リクエストは404。
    recommended_material_idsは、フロントエンドが追加のAPI呼び出し無しで表示・リンクできるよう、
    教材タイトルを解決して{id, title}の配列として返す（生成時点でのタイトルではなく現在のタイトルを
    都度解決するため、教材名変更後も古いタイトルが表示され続けることがない）。"""
    await _require_report_access(user_id, user)
    pool = get_pool()
    row = await pool.fetchrow(
        """SELECT content, requested_at FROM ai_personal_feedback WHERE user_id = $1
           ORDER BY created_at DESC LIMIT 1""",
        user_id,
    )
    if row is None or row["content"] is None:
        raise HTTPException(404, detail="AI個人フィードバックはまだ生成されていません")
    content = json.loads(row["content"])
    material_ids = content.get("recommended_material_ids", [])
    materials = []
    if material_ids:
        material_rows = await pool.fetch(
            "SELECT id, title FROM materials WHERE id = ANY($1::bigint[])", material_ids
        )
        by_id = {r["id"]: r["title"] for r in material_rows}
        materials = [{"id": mid, "title": by_id[mid]} for mid in material_ids if mid in by_id]
    return {
        "comment": content.get("comment", ""),
        "weak_areas": content.get("weak_areas", []),
        "recommended_materials": materials,
        "generated_at": row["requested_at"],
    }
