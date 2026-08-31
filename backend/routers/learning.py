# 受講・受験API（A-40〜A-44, A-71〜A-72。詳細設計書7.2.5節）。S-04（目次）・S-16（ページ受講）から呼ばれる。
import asyncio
import json
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import ai_client
from auth_helpers import CurrentUser, require_auth
from database import get_pool
from routers.materials import _count_pages, _fetch_tree, _material_dict, _require_view_access

router = APIRouter(prefix="/api", tags=["learning"])

logger = logging.getLogger("manabi.learning")

# 配信設定（T-11 assignments.pass_score_pct等）は本来教材ごとに1つに定めるが、S-06（配信設定画面）が
# 未実装でassignments行が作られる経路が無いため、該当行が無い場合の暫定既定値として使う
# （S-06実装時にassignments行が存在するようになれば、そちらの値を優先する）。
DEFAULT_PASS_SCORE_PCT = 70.0
DEFAULT_RETAKE_ALLOWED = True
DEFAULT_RETAKE_LIMIT = None

GRADABLE_TYPES = ("single", "multi", "reorder", "free_text", "code")


def _collect_pages(nodes: list[dict]) -> list[dict]:
    """ツリーからkind='page'のノードだけをフラットに集める（順序保持）。"""
    pages = []
    for n in nodes:
        if n["kind"] == "page":
            pages.append(n)
        pages.extend(_collect_pages(n.get("children", [])))
    return pages


def _find_node(nodes: list[dict], node_id: int) -> dict | None:
    for n in nodes:
        if n["id"] == node_id:
            return n
        found = _find_node(n.get("children", []), node_id)
        if found:
            return found
    return None


def _scope_pages(tree: list[dict], attempt_scope: str, scope_node_id: int | None) -> list[dict]:
    """attempt_scope・scope_node_idから対象となるページノード一覧を求める。"""
    if attempt_scope == "material":
        return _collect_pages(tree)
    if scope_node_id is None:
        raise HTTPException(422, detail="この教材はscope_node_idの指定が必要です")
    node = _find_node(tree, scope_node_id)
    if node is None:
        raise HTTPException(404, detail="指定されたノードが見つかりません")
    if node["kind"] == "page":
        return [node]
    return _collect_pages(node.get("children", []))


def _scope_groups(tree: list[dict], attempt_scope: str) -> list[dict]:
    """A-86用。attempt_scopeに応じたスコープ群（{scope_node_id, label}）を列挙する。
    'material'なら1件、'chapter'なら章ノードごと、'section'なら小見出しノード＋小見出しの無い
    章直下ページ用のフォールバック群（resolveScopeNodeIdのフロントエンド側フォールバックと対称）、
    'page'ならページノードごと。"""
    if attempt_scope == "material":
        return [{"scope_node_id": None, "label": "教材全体"}]
    chapters = [n for n in tree if n["kind"] == "chapter"]
    if attempt_scope == "chapter":
        return [{"scope_node_id": c["id"], "label": c["title"]} for c in chapters]
    if attempt_scope == "section":
        groups: list[dict] = []
        for c in chapters:
            children = c.get("children", [])
            for s in [n for n in children if n["kind"] == "section"]:
                groups.append({"scope_node_id": s["id"], "label": s["title"]})
            if any(n["kind"] == "page" for n in children):
                groups.append({"scope_node_id": c["id"], "label": c["title"]})
        return groups
    return [{"scope_node_id": p["id"], "label": p["title"]} for p in _collect_pages(tree)]


def _draw_question_order(pages: list[dict]) -> dict:
    """各ページのquiz_mode='pool'設問をpool_group_idごとにpool_draw_count件だけ抽選し、
    ページのnode_id -> 出題する設問IDリストのマップを作る（v1.17出題プール設定の実行）。"""
    question_order: dict[str, list[int]] = {}
    for page in pages:
        questions = page.get("questions", [])
        if page.get("quiz_mode") != "pool" or not questions:
            question_order[str(page["id"])] = [q["id"] for q in questions]
            continue
        by_group: dict[int | None, list[dict]] = {}
        for q in questions:
            by_group.setdefault(q.get("pool_group"), []).append(q)
        draw_count = page.get("pool_draw_count") or 1
        chosen: list[int] = []
        for group_id, group_questions in by_group.items():
            if group_id is None:
                chosen.extend(q["id"] for q in group_questions)
                continue
            pool = group_questions[:]
            random.shuffle(pool)
            chosen.extend(q["id"] for q in pool[:draw_count])
        # 元のsort_order基準の並びに戻す
        order_index = {q["id"]: i for i, q in enumerate(questions)}
        chosen.sort(key=lambda qid: order_index[qid])
        question_order[str(page["id"])] = chosen
    return question_order


async def _resolve_assignment_settings(pool, material_id: int, project_id: int, user_id: int) -> dict:
    """配信設定（T-11 assignments）からpass_score_pct・retake_allowed・retake_limitを取得する。
    自分に適用される行（プロジェクトスコープまたは個人指定）を1件取得し、無ければ暫定既定値を使う
    （S-06未実装のためassignments行が存在しない運用が当面続くことを踏まえた措置）。"""
    row = await pool.fetchrow(
        """SELECT pass_score_pct, retake_allowed, retake_limit FROM assignments
            WHERE material_id = $1
              AND ((scope_type = 'project' AND scope_id = $2)
                   OR (scope_type = 'individual' AND scope_id = $3))
            LIMIT 1""",
        material_id, project_id, user_id,
    )
    if row is None:
        return {
            "pass_score_pct": DEFAULT_PASS_SCORE_PCT,
            "retake_allowed": DEFAULT_RETAKE_ALLOWED,
            "retake_limit": DEFAULT_RETAKE_LIMIT,
        }
    return {
        "pass_score_pct": float(row["pass_score_pct"]) if row["pass_score_pct"] is not None else DEFAULT_PASS_SCORE_PCT,
        "retake_allowed": row["retake_allowed"],
        "retake_limit": row["retake_limit"],
    }


class StartAttemptIn(BaseModel):
    mode: Literal["graded", "practice"] = "graded"
    scope_node_id: int | None = None


@router.post("/materials/{id}/attempts", status_code=201)
async def start_attempt(id: int, body: StartAttemptIn, user: CurrentUser = Depends(require_auth)):
    """A-40: 受験開始。未提出の試行があれば再開し、無ければ新規作成する。
    (user_id, material_id, mode, scope_node_id)の組でsubmitted_at IS NULLな行を高々1件に保つ
    部分ユニークインデックス（uq_quiz_attempts_active）を使い、INSERT ... ON CONFLICT DO UPDATEで
    「無ければ作る・あれば取得する」を1クエリでアトミックに行う。S-16実装時、Reactの開発時
    StrictModeによるページ遷移エフェクトの二重発火で、素朴なSELECTしてから無ければINSERTという
    実装だと同一スコープの未提出試行が2件作られてしまう競合状態を発見し、この方式に修正した。"""
    pool = get_pool()
    perm_row = await _require_view_access(pool, id, user)
    material_row = await pool.fetchrow(
        "SELECT id, project_id, attempt_scope FROM materials WHERE id = $1", id
    )
    tree = await _fetch_tree(pool, id, strip_answers=True)
    attempt_scope = material_row["attempt_scope"]
    if body.mode == "practice":
        # 反復演習はmaterials.attempt_scopeの設定によらず常に教材全体を対象にする
        # （章単位・ページ単位のgraded受験とは独立した練習セッションのため）
        scope_node_id = None
        pages = _collect_pages(tree)
    else:
        scope_node_id = body.scope_node_id if attempt_scope != "material" else None
        pages = _scope_pages(tree, attempt_scope, scope_node_id)

    # 反復演習（mode='practice'の全ページ通し）はpractice_kind='repeat'で記録する。誤答のみ抽出
    # （A-44）はpractice_kind='wrong_only'で別途記録するため、両者はmode/scope_node_idが同じでも
    # 部分ユニークインデックス上で衝突しない。
    practice_kind = "repeat" if body.mode == "practice" else None
    attempt_no = await pool.fetchval(
        """SELECT COUNT(*) FROM quiz_attempts
            WHERE user_id = $1 AND material_id = $2 AND mode = $3
              AND scope_node_id IS NOT DISTINCT FROM $4 AND practice_kind IS NOT DISTINCT FROM $5""",
        user.id, id, body.mode, scope_node_id, practice_kind,
    ) + 1
    question_order = _draw_question_order(pages)
    row = await pool.fetchrow(
        """INSERT INTO quiz_attempts
               (user_id, material_id, scope_node_id, mode, attempt_no, question_order, practice_kind)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, material_id, mode, scope_node_id, practice_kind) WHERE submitted_at IS NULL
           DO UPDATE SET attempt_no = quiz_attempts.attempt_no
           RETURNING *, (xmax = 0) AS inserted""",
        user.id, id, scope_node_id, body.mode, attempt_no, json.dumps(question_order), practice_kind,
    )
    attempt = dict(row)
    is_new = attempt.pop("inserted")
    attempt["question_order"] = json.loads(attempt["question_order"]) if attempt["question_order"] else {}
    attempt["carried_over_question_ids"] = (
        json.loads(attempt["carried_over_question_ids"]) if attempt["carried_over_question_ids"] else []
    )

    answers = await pool.fetch(
        "SELECT question_id, response, is_correct FROM answers WHERE attempt_id = $1", attempt["id"]
    )
    answers_out = [
        {**dict(a), "response": json.loads(a["response"]) if a["response"] else None} for a in answers
    ]

    if is_new:
        # enrollment_progressの初期化（未着手→着手中）。既存試行の再開時は触らない。
        await pool.execute(
            """INSERT INTO enrollment_progress (user_id, material_id, status, started_at)
               VALUES ($1, $2, 'in_progress', now())
               ON CONFLICT (user_id, material_id) DO UPDATE
                 SET status = CASE WHEN enrollment_progress.status = 'not_started' THEN 'in_progress'
                                    ELSE enrollment_progress.status END,
                     started_at = COALESCE(enrollment_progress.started_at, now())""",
            user.id, id,
        )

    return {"attempt": attempt, "toc": tree, "answers": answers_out}


class SaveAnswerIn(BaseModel):
    question_id: int
    response: dict | list | str | int | float | bool | None = None


def _grade_deterministic(qtype: str, correct_answer, response) -> bool | None:
    if qtype == "single":
        return response == correct_answer
    if qtype == "multi":
        if not isinstance(response, list) or not isinstance(correct_answer, list):
            return False
        return sorted(response) == sorted(correct_answer)
    if qtype == "reorder":
        return response == correct_answer
    return None  # free_text/code/score_logは非即時（Noneのまま保存）


@router.put("/attempts/{attempt_id}/answers")
async def save_answer(attempt_id: int, body: SaveAnswerIn, user: CurrentUser = Depends(require_auth)):
    """A-41: 回答保存（都度呼び出しで中断・再開を実現）。"""
    pool = get_pool()
    attempt = await pool.fetchrow("SELECT * FROM quiz_attempts WHERE id = $1", attempt_id)
    if attempt is None:
        raise HTTPException(404, detail="受験記録が見つかりません")
    if attempt["user_id"] != user.id:
        raise HTTPException(403, detail="この受験記録を操作する権限がありません")
    if attempt["submitted_at"] is not None:
        raise HTTPException(400, detail="この受験記録は提出済みのため回答を保存できません")

    question = await pool.fetchrow(
        "SELECT id, node_id, type, correct_answer FROM questions WHERE id = $1", body.question_id
    )
    if question is None:
        raise HTTPException(404, detail="設問が見つかりません")
    correct_answer = json.loads(question["correct_answer"]) if question["correct_answer"] is not None else None
    is_correct = _grade_deterministic(question["type"], correct_answer, body.response)

    row = await pool.fetchrow(
        """INSERT INTO answers (attempt_id, question_id, response, is_correct)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (attempt_id, question_id) DO UPDATE
             SET response = $3, is_correct = $4, updated_at = now()
           RETURNING *""",
        attempt_id, body.question_id, json.dumps(body.response), is_correct,
    )

    # 「続きから受講」の再開位置はgraded試行のみで更新する。反復演習・誤答のみ抽出（mode='practice'）は
    # 独立した練習セッションのため、ここで更新すると本来のgraded進行の再開位置を意図せず書き換えてしまう
    # 不具合になる（S-04残り機能実装時に発見）。
    if attempt["mode"] == "graded":
        await pool.execute(
            """UPDATE enrollment_progress SET current_node_id = $1, updated_at = now()
                WHERE user_id = $2 AND material_id = $3""",
            question["node_id"], user.id, attempt["material_id"],
        )
    result = dict(row)
    result["response"] = json.loads(result["response"]) if result["response"] else None
    return result


def _collect_nodes_of_kind(nodes: list[dict], kind: str) -> list[dict]:
    result = []
    for n in nodes:
        if n["kind"] == kind:
            result.append(n)
        result.extend(_collect_nodes_of_kind(n.get("children", []), kind))
    return result


async def _recompute_attempt_result(pool, attempt_id: int) -> None:
    """A-42・A-74・_grade_and_store_answer（AI採点完了後）で共通利用する合否再計算処理。"""
    attempt = await pool.fetchrow("SELECT * FROM quiz_attempts WHERE id = $1", attempt_id)
    if attempt is None:
        return
    rows = await pool.fetch(
        """SELECT a.is_correct, q.type, q.is_critical, q.prompt
           FROM answers a JOIN questions q ON q.id = a.question_id
           WHERE a.attempt_id = $1""",
        attempt_id,
    )
    gradable = [r for r in rows if r["type"] != "score_log"]
    total = len(gradable)
    correct = sum(1 for r in gradable if r["is_correct"])
    score_pct = (correct / total * 100) if total > 0 else 100.0

    passed = None
    fail_reason = None
    if attempt["mode"] == "graded":
        critical_fail = next((r for r in rows if r["is_critical"] and r["is_correct"] is False), None)
        if critical_fail is not None:
            passed = False
            fail_reason = critical_fail["prompt"]
        else:
            material = await pool.fetchrow(
                "SELECT project_id FROM materials WHERE id = $1", attempt["material_id"]
            )
            settings = await _resolve_assignment_settings(
                pool, attempt["material_id"], material["project_id"], attempt["user_id"]
            )
            passed = score_pct >= settings["pass_score_pct"]

    await pool.execute(
        "UPDATE quiz_attempts SET score_pct = $1, passed = $2, fail_reason = $3 WHERE id = $4",
        score_pct, passed, fail_reason, attempt_id,
    )


async def _grade_and_store_answer(answer_id: int) -> None:
    """記述式・コード記述式の回答をAI採点し（F-20）、結果をDBへ保存したうえで受験記録の
    合否を再計算する。A-42（提出時の起動）・job_sweep（滞留ジョブの再実行）の両方から呼ばれる。
    AI呼び出しが最終的に失敗した場合は何もせずNULLのまま残す（呼び出し元でリトライ対象になる）。"""
    pool = get_pool()
    row = await pool.fetchrow(
        """SELECT a.id, a.attempt_id, a.response,
                  q.prompt, q.scoring_criteria, q.code_language, q.type, q.feedback_style AS q_feedback_style,
                  m.default_feedback_style, m.ai_context, qa.user_id
           FROM answers a
           JOIN questions q ON q.id = a.question_id
           JOIN quiz_attempts qa ON qa.id = a.attempt_id
           JOIN materials m ON m.id = qa.material_id
           WHERE a.id = $1""",
        answer_id,
    )
    if row is None or row["scoring_criteria"] is None:
        return
    response_text = json.loads(row["response"]) if row["response"] else ""
    feedback_style = row["q_feedback_style"] or row["default_feedback_style"]
    try:
        result = await ai_client.grade_answer(
            prompt=row["prompt"],
            response_text=str(response_text),
            scoring_criteria=row["scoring_criteria"],
            feedback_style=feedback_style,
            ai_context=row["ai_context"],
            is_code=row["type"] == "code",
            code_language=row["code_language"],
            user_id=row["user_id"],
        )
    except Exception:
        logger.exception("AI採点が最終的に失敗しました（answer_id=%s）", answer_id)
        return

    feedback_text = result.get("reasoning") or ""
    if result.get("improvement_suggestions"):
        feedback_text = f"{feedback_text}\n\n改善提案: {result['improvement_suggestions']}"
    await pool.execute(
        """UPDATE answers SET is_correct = $1, ai_score_pct = $2, ai_feedback = $3, updated_at = now()
            WHERE id = $4""",
        bool(result["correct"]), float(result["score_pct"]), feedback_text, answer_id,
    )
    await _recompute_attempt_result(pool, row["attempt_id"])


async def _update_enrollment_progress(
    pool, user_id: int, material_id: int, attempt_scope: str, tree: list[dict], newly_submitted_page_ids: list[int]
) -> None:
    """6.6節: 提出時の進捗更新。attempt_scope='material'なら全ページ提出済みで完了、
    それ以外なら該当種別の全ノードが合格済みかどうかで教材全体の完了を決める。"""
    row = await pool.fetchrow(
        "SELECT completed_node_ids FROM enrollment_progress WHERE user_id = $1 AND material_id = $2",
        user_id, material_id,
    )
    existing = set(json.loads(row["completed_node_ids"])) if row else set()
    existing |= set(newly_submitted_page_ids)

    if attempt_scope == "material":
        all_page_ids = {p["id"] for p in _collect_pages(tree)}
        is_complete = all_page_ids.issubset(existing)
    else:
        group_nodes = _collect_nodes_of_kind(tree, attempt_scope)
        is_complete = True
        for g in group_nodes:
            latest = await pool.fetchrow(
                """SELECT passed FROM quiz_attempts
                    WHERE user_id = $1 AND material_id = $2 AND scope_node_id = $3
                      AND mode = 'graded' AND submitted_at IS NOT NULL
                    ORDER BY attempt_no DESC LIMIT 1""",
                user_id, material_id, g["id"],
            )
            if latest is None or not latest["passed"]:
                is_complete = False
                break

    status = "completed" if is_complete else "in_progress"
    await pool.execute(
        """INSERT INTO enrollment_progress (user_id, material_id, status, completed_node_ids, completed_at)
           VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'completed' THEN now() ELSE NULL END)
           ON CONFLICT (user_id, material_id) DO UPDATE
             SET status = $3, completed_node_ids = $4,
                 completed_at = CASE WHEN $3 = 'completed'
                                     THEN COALESCE(enrollment_progress.completed_at, now()) ELSE NULL END,
                 updated_at = now()""",
        user_id, material_id, status, json.dumps(sorted(existing)),
    )


@router.post("/attempts/{attempt_id}/submit")
async def submit_attempt(attempt_id: int, user: CurrentUser = Depends(require_auth)):
    """A-42: 提出。選択式は即時採点済み、記述式・コード記述式はAI採点を非同期起動する
    （grading_mode='manual'の場合はS-20の手動採点まで未採点のまま）。"""
    pool = get_pool()
    attempt = await pool.fetchrow("SELECT * FROM quiz_attempts WHERE id = $1", attempt_id)
    if attempt is None:
        raise HTTPException(404, detail="受験記録が見つかりません")
    if attempt["user_id"] != user.id:
        raise HTTPException(403, detail="この受験記録を操作する権限がありません")
    if attempt["submitted_at"] is not None:
        raise HTTPException(400, detail="この受験記録は既に提出済みです")

    material = await pool.fetchrow("SELECT * FROM materials WHERE id = $1", attempt["material_id"])
    await pool.execute("UPDATE quiz_attempts SET submitted_at = now() WHERE id = $1", attempt_id)

    pending = await pool.fetch(
        """SELECT a.id, q.grading_mode AS q_grading_mode
           FROM answers a JOIN questions q ON q.id = a.question_id
           WHERE a.attempt_id = $1 AND a.ai_score_pct IS NULL AND a.is_correct IS NULL
             AND q.type IN ('free_text', 'code')""",
        attempt_id,
    )
    for p in pending:
        effective_mode = p["q_grading_mode"] or material["grading_mode"]
        if effective_mode == "ai":
            asyncio.create_task(_grade_and_store_answer(p["id"]))

    await _recompute_attempt_result(pool, attempt_id)

    if attempt["mode"] == "graded":
        tree = await _fetch_tree(pool, attempt["material_id"], strip_answers=True)
        pages = _scope_pages(tree, material["attempt_scope"], attempt["scope_node_id"])
        await _update_enrollment_progress(
            pool, user.id, attempt["material_id"], material["attempt_scope"], tree, [p["id"] for p in pages]
        )

    result = await pool.fetchrow("SELECT * FROM quiz_attempts WHERE id = $1", attempt_id)
    return dict(result)


@router.get("/attempts/{attempt_id}")
async def get_attempt(attempt_id: int, user: CurrentUser = Depends(require_auth)):
    """A-43: 受験記録の結果取得。本人、または対象教材が紐づくプロジェクトの管理者・編集者・adminが見られる。"""
    pool = get_pool()
    attempt = await pool.fetchrow("SELECT * FROM quiz_attempts WHERE id = $1", attempt_id)
    if attempt is None:
        raise HTTPException(404, detail="受験記録が見つかりません")
    if attempt["user_id"] != user.id and user.role != "admin":
        material = await pool.fetchrow("SELECT project_id FROM materials WHERE id = $1", attempt["material_id"])
        project_role = await pool.fetchval(
            """SELECT role FROM project_memberships
                WHERE project_id = $1 AND user_id = $2 AND status = 'active' AND left_at IS NULL""",
            material["project_id"], user.id,
        )
        if project_role not in ("editor", "admin"):
            raise HTTPException(403, detail="この受験記録を閲覧する権限がありません")

    answers = await pool.fetch(
        """SELECT a.*, q.prompt, q.type, q.is_critical
           FROM answers a JOIN questions q ON q.id = a.question_id
           WHERE a.attempt_id = $1 ORDER BY q.sort_order""",
        attempt_id,
    )
    result = dict(attempt)
    result["question_order"] = json.loads(result["question_order"]) if result["question_order"] else {}
    result["carried_over_question_ids"] = (
        json.loads(result["carried_over_question_ids"]) if result["carried_over_question_ids"] else []
    )
    result["answers"] = [
        {**dict(a), "response": json.loads(a["response"]) if a["response"] else None} for a in answers
    ]
    return result


@router.post("/attempts/{attempt_id}/retake", status_code=201)
async def retake_attempt(attempt_id: int, user: CurrentUser = Depends(require_auth)):
    """A-71: 再受験を開始する。retake_scope='wrong_only'なら前回正解済みの設問を除外し
    carried_over_question_idsに記録する。"""
    pool = get_pool()
    prev = await pool.fetchrow("SELECT * FROM quiz_attempts WHERE id = $1", attempt_id)
    if prev is None:
        raise HTTPException(404, detail="受験記録が見つかりません")
    if prev["user_id"] != user.id:
        raise HTTPException(403, detail="この受験記録を操作する権限がありません")
    if prev["submitted_at"] is None:
        raise HTTPException(400, detail="未提出の受験記録は再受験できません")

    material = await pool.fetchrow("SELECT * FROM materials WHERE id = $1", prev["material_id"])
    settings = await _resolve_assignment_settings(pool, prev["material_id"], material["project_id"], user.id)
    if not settings["retake_allowed"]:
        raise HTTPException(400, detail="この教材は再受験できません")
    attempt_count = await pool.fetchval(
        """SELECT COUNT(*) FROM quiz_attempts
            WHERE user_id = $1 AND material_id = $2 AND scope_node_id IS NOT DISTINCT FROM $3 AND mode = 'graded'""",
        user.id, prev["material_id"], prev["scope_node_id"],
    )
    if settings["retake_limit"] is not None and attempt_count >= settings["retake_limit"]:
        raise HTTPException(400, detail="再受験回数の上限に達しています")

    tree = await _fetch_tree(pool, prev["material_id"], strip_answers=True)
    pages = _scope_pages(tree, material["attempt_scope"], prev["scope_node_id"])
    question_order = json.loads(prev["question_order"]) if prev["question_order"] else _draw_question_order(pages)

    carried_over: list[int] = []
    if material["retake_scope"] == "wrong_only":
        prev_answers = await pool.fetch(
            "SELECT question_id, is_correct FROM answers WHERE attempt_id = $1", attempt_id
        )
        correct_ids = {a["question_id"] for a in prev_answers if a["is_correct"]}
        carried_over = sorted(correct_ids)
        question_order = {
            node_id: [qid for qid in qids if qid not in correct_ids] for node_id, qids in question_order.items()
        }

    new_attempt = await pool.fetchrow(
        """INSERT INTO quiz_attempts
               (user_id, material_id, scope_node_id, mode, attempt_no, question_order, carried_over_question_ids)
           VALUES ($1, $2, $3, 'graded', $4, $5, $6)
           RETURNING *""",
        user.id, prev["material_id"], prev["scope_node_id"], attempt_count + 1,
        json.dumps(question_order), json.dumps(carried_over),
    )
    result = dict(new_attempt)
    result["question_order"] = question_order
    result["carried_over_question_ids"] = carried_over
    return {"attempt": result, "toc": tree}


class WrongQuestionsIn(BaseModel):
    scope: Literal["material", "all"] = "material"


@router.post("/materials/{id}/wrong-questions-attempts", status_code=201)
async def start_wrong_questions_attempt(id: int, body: WrongQuestionsIn, user: CurrentUser = Depends(require_auth)):
    """A-44: 誤答のみ抽出出題を開始する（mode='practice'。合否・ドボン判定は行わない）。
    自分の直近の誤答に加え、全受講者の正答率が50%未満の設問も対象に含める。"""
    pool = get_pool()
    await _require_view_access(pool, id, user)

    material_filter = "AND qa.material_id = $2" if body.scope == "material" else ""
    params = [user.id, id] if body.scope == "material" else [user.id]
    own_wrong = await pool.fetch(
        f"""SELECT question_id FROM (
              SELECT DISTINCT ON (a.question_id) a.question_id, a.is_correct
              FROM answers a
              JOIN quiz_attempts qa ON qa.id = a.attempt_id
              JOIN questions q ON q.id = a.question_id
              WHERE qa.user_id = $1 {material_filter} AND q.type != 'score_log'
              ORDER BY a.question_id, a.created_at DESC
            ) latest WHERE is_correct = false""",
        *params,
    )
    question_ids = {r["question_id"] for r in own_wrong}

    low_rate_filter = "AND q.material_id = $1" if body.scope == "material" else ""
    low_rate_params = [id] if body.scope == "material" else []
    low_rate = await pool.fetch(
        f"""SELECT a.question_id FROM answers a
            JOIN questions q ON q.id = a.question_id
            WHERE a.is_correct IS NOT NULL {low_rate_filter}
            GROUP BY a.question_id HAVING AVG(a.is_correct::int) < 0.5""",
        *low_rate_params,
    )
    question_ids |= {r["question_id"] for r in low_rate}

    if not question_ids:
        raise HTTPException(400, detail="対象となる誤答問題がありません")

    rows = await pool.fetch(
        "SELECT id, node_id, material_id FROM questions WHERE id = ANY($1::bigint[])", list(question_ids)
    )
    if body.scope == "all":
        accessible_material_ids: set[int] = set()
        for material_id in {r["material_id"] for r in rows}:
            try:
                await _require_view_access(pool, material_id, user)
                accessible_material_ids.add(material_id)
            except HTTPException:
                continue
        rows = [r for r in rows if r["material_id"] in accessible_material_ids]

    if not rows:
        raise HTTPException(400, detail="対象となる誤答問題がありません")

    by_material: dict[int, list] = {}
    for r in rows:
        by_material.setdefault(r["material_id"], []).append(r)

    attempts = []
    for material_id, material_rows in by_material.items():
        question_order: dict[str, list[int]] = {}
        for r in material_rows:
            question_order.setdefault(str(r["node_id"]), []).append(r["id"])
        # practice_kind='wrong_only'で反復演習（'repeat'）と区別し、部分ユニークインデックス
        # （uq_quiz_attempts_active）への衝突を避ける。ON CONFLICT DO UPDATEで、同じ抽出条件の
        # 未提出試行が既にあれば取得し直す（二重クリック等での重複作成を防ぐ）。
        attempt = await pool.fetchrow(
            """INSERT INTO quiz_attempts (user_id, material_id, mode, attempt_no, question_order, practice_kind)
               VALUES ($1, $2, 'practice', 1, $3, 'wrong_only')
               ON CONFLICT (user_id, material_id, mode, scope_node_id, practice_kind) WHERE submitted_at IS NULL
               DO UPDATE SET attempt_no = quiz_attempts.attempt_no
               RETURNING *""",
            user.id, material_id, json.dumps(question_order),
        )
        result = dict(attempt)
        result["question_order"] = json.loads(result["question_order"]) if result["question_order"] else {}
        attempts.append(result)
    return {"attempts": attempts}


@router.get("/materials/{id}/attempt-summary")
async def get_attempt_summary(id: int, user: CurrentUser = Depends(require_auth)):
    """A-86: S-04「前回の受験結果パネル」「AI採点結果パネル」向け。attempt_scopeで定まる
    スコープ群ごとに、自分の最新graded試行（提出済みのもの。無ければそのスコープは省略する）と、
    その記述式・コード記述式の回答（AI講評込み）をまとめて返す。"""
    pool = get_pool()
    await _require_view_access(pool, id, user)
    material = await pool.fetchrow("SELECT * FROM materials WHERE id = $1", id)
    tree = await _fetch_tree(pool, id, strip_answers=True)
    groups = _scope_groups(tree, material["attempt_scope"])
    settings = await _resolve_assignment_settings(pool, id, material["project_id"], user.id)

    entries = []
    for g in groups:
        attempt = await pool.fetchrow(
            """SELECT id, attempt_no, score_pct, passed, fail_reason, submitted_at
               FROM quiz_attempts
               WHERE user_id = $1 AND material_id = $2 AND mode = 'graded'
                 AND scope_node_id IS NOT DISTINCT FROM $3 AND submitted_at IS NOT NULL
               ORDER BY attempt_no DESC LIMIT 1""",
            user.id, id, g["scope_node_id"],
        )
        if attempt is None:
            continue
        attempt_count = await pool.fetchval(
            """SELECT COUNT(*) FROM quiz_attempts
                WHERE user_id = $1 AND material_id = $2 AND mode = 'graded'
                  AND scope_node_id IS NOT DISTINCT FROM $3""",
            user.id, id, g["scope_node_id"],
        )
        answers = await pool.fetch(
            """SELECT a.question_id, q.prompt, q.type, a.is_correct, a.ai_score_pct, a.ai_feedback
               FROM answers a JOIN questions q ON q.id = a.question_id
               WHERE a.attempt_id = $1 AND q.type IN ('free_text', 'code')
               ORDER BY q.sort_order""",
            attempt["id"],
        )
        entries.append({
            "scope_node_id": g["scope_node_id"],
            "scope_label": g["label"],
            "attempt": dict(attempt),
            "attempt_count": attempt_count,
            "retake_allowed": settings["retake_allowed"],
            "retake_limit": settings["retake_limit"],
            "answers": [dict(a) for a in answers],
        })
    return {"items": entries}


@router.get("/materials/{id}/practice-attempts")
async def list_practice_attempts(id: int, user: CurrentUser = Depends(require_auth)):
    """A-87: 反復演習タブの実施履歴。自分のmode='practice', practice_kind='repeat'な
    提出済み試行を新しい順で返す。"""
    pool = get_pool()
    await _require_view_access(pool, id, user)
    rows = await pool.fetch(
        """SELECT qa.id, qa.score_pct, qa.submitted_at,
                  EXTRACT(EPOCH FROM (qa.submitted_at - qa.started_at))::int AS duration_seconds,
                  (SELECT COUNT(*) FROM answers a JOIN questions q ON q.id = a.question_id
                    WHERE a.attempt_id = qa.id AND q.type != 'score_log') AS total_count,
                  (SELECT COUNT(*) FROM answers a JOIN questions q ON q.id = a.question_id
                    WHERE a.attempt_id = qa.id AND q.type != 'score_log' AND a.is_correct = true) AS correct_count
           FROM quiz_attempts qa
           WHERE qa.user_id = $1 AND qa.material_id = $2 AND qa.mode = 'practice'
             AND qa.practice_kind = 'repeat' AND qa.submitted_at IS NOT NULL
           ORDER BY qa.submitted_at DESC""",
        user.id, id,
    )
    return {"items": [dict(r) for r in rows]}


@router.get("/questions/{question_id}/my-scores")
async def get_my_question_scores(question_id: int, user: CurrentUser = Depends(require_auth)):
    """A-88: スコア記録設問の「これまでの記録」。本人の過去のresponse.scoreを新しい順で返す
    （常に自分自身のデータのみを対象にするため、教材単位のアクセス制御は不要）。"""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT a.response, a.created_at
           FROM answers a JOIN quiz_attempts qa ON qa.id = a.attempt_id
           WHERE a.question_id = $1 AND qa.user_id = $2 AND a.response IS NOT NULL
           ORDER BY a.created_at DESC LIMIT 10""",
        question_id, user.id,
    )
    items = []
    for r in rows:
        response = json.loads(r["response"])
        if isinstance(response, dict) and "score" in response:
            items.append({"score": response["score"], "recorded_at": r["created_at"]})
    return {"items": items}


def _next_action(status: str) -> str:
    if status == "completed":
        return "review"
    if status == "in_progress":
        return "resume"
    return "start"


@router.get("/my-learning")
async def get_my_learning(history: bool = False, user: CurrentUser = Depends(require_auth)):
    """A-39: マイ学習一覧（S-02）。詳細設計書6.2節。

    history=falseの既定モード: 対象教材IDを5.3節require_material_accessの2条件（プロジェクトの
    現役メンバー・個人指定の配信）のORで求め、必修/任意に分類して返す。任意教材のうち所属
    プロジェクトが全社Wiki（is_company_wide=true）のものは、さらにT-30 my_learning_registrations
    に本人の登録行が無いと除外する（F-31）。招待制プロジェクトの任意教材・必修教材は登録有無を
    問わず常に含める。

    history=trueの「学習履歴」モード: 登録・現在の受講対象かどうかを一切問わず、enrollment_progress
    に本人の行がある（一度でも着手した）教材を横断的に返す（過去に参加していたプロジェクトを
    離任した後でも履歴として残る）。
    """
    pool = get_pool()

    if history:
        rows = await pool.fetch(
            """SELECT m.id, m.title, m.tags, m.project_id, p.name AS project_name, p.is_company_wide,
                      COALESCE(nc.page_count, 0) AS page_count,
                      COALESCE(asg.required, false) AS required, asg.due_at,
                      ep.status AS progress_status, ep.completed_node_ids, ep.completed_at,
                      ep.updated_at AS progress_updated_at
               FROM materials m
               JOIN projects p ON p.id = m.project_id
               JOIN enrollment_progress ep ON ep.material_id = m.id AND ep.user_id = $1
               LEFT JOIN (
                   SELECT material_id, COUNT(*) FILTER (WHERE kind = 'page') AS page_count
                   FROM material_nodes GROUP BY material_id
               ) nc ON nc.material_id = m.id
               LEFT JOIN LATERAL (
                   SELECT required, due_at FROM assignments a
                   WHERE a.material_id = m.id
                     AND ((a.scope_type = 'project' AND a.scope_id = m.project_id)
                          OR (a.scope_type = 'individual' AND a.scope_id = $1))
                   ORDER BY required DESC, due_at ASC NULLS LAST LIMIT 1
               ) asg ON true
               WHERE m.status = 'published' AND m.is_archived = false
               ORDER BY ep.updated_at DESC""",
            user.id,
        )
        items = [_my_learning_item(r) for r in rows]
        return {"items": items}

    rows = await pool.fetch(
        """SELECT m.id, m.title, m.tags, m.project_id, p.name AS project_name, p.is_company_wide,
                  COALESCE(nc.page_count, 0) AS page_count,
                  COALESCE(asg.required, false) AS required, asg.due_at,
                  ep.status AS progress_status, ep.completed_node_ids, ep.completed_at,
                  ep.updated_at AS progress_updated_at, m.updated_at
           FROM materials m
           JOIN projects p ON p.id = m.project_id
           LEFT JOIN (
               SELECT material_id, COUNT(*) FILTER (WHERE kind = 'page') AS page_count
               FROM material_nodes GROUP BY material_id
           ) nc ON nc.material_id = m.id
           LEFT JOIN LATERAL (
               SELECT required, due_at FROM assignments a
               WHERE a.material_id = m.id
                 AND ((a.scope_type = 'project' AND a.scope_id = m.project_id)
                      OR (a.scope_type = 'individual' AND a.scope_id = $1))
               ORDER BY required DESC, due_at ASC NULLS LAST LIMIT 1
           ) asg ON true
           LEFT JOIN enrollment_progress ep ON ep.material_id = m.id AND ep.user_id = $1
           WHERE m.status = 'published' AND m.is_archived = false
             AND (
               EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = m.project_id
                       AND pm.user_id = $1 AND pm.status = 'active' AND pm.left_at IS NULL)
               OR EXISTS (SELECT 1 FROM assignments ia WHERE ia.material_id = m.id
                          AND ia.scope_type = 'individual' AND ia.scope_id = $1)
             )""",
        user.id,
    )
    registered_ids = {
        r["material_id"] for r in await pool.fetch(
            "SELECT material_id FROM my_learning_registrations WHERE user_id = $1", user.id
        )
    }

    required_items = []
    optional_items = []
    for r in rows:
        if not r["required"] and r["is_company_wide"] and r["id"] not in registered_ids:
            continue
        item = _my_learning_item(r)
        item["registered"] = r["id"] in registered_ids
        (required_items if r["required"] else optional_items).append(item)

    required_items.sort(key=lambda i: (i["due_at"] is None, i["due_at"]))
    optional_items.sort(key=lambda i: i["updated_at"] or "", reverse=True)

    total_required = len(required_items)
    completed_required = sum(1 for i in required_items if i["progress_status"] == "completed")
    required_completion_pct = round(100 * completed_required / total_required) if total_required else 0
    now = datetime.now(timezone.utc)
    urgent_required_count = sum(
        1 for i in required_items
        if i["progress_status"] != "completed" and i["due_at"] is not None
        and i["due_at"] <= now + timedelta(days=7)
    )
    optional_completed_count = sum(1 for i in optional_items if i["progress_status"] == "completed")
    last_activity_at = await pool.fetchval(
        "SELECT MAX(updated_at) FROM enrollment_progress WHERE user_id = $1", user.id
    )

    return {
        "required": required_items,
        "optional": optional_items,
        "stats": {
            "required_completion_pct": required_completion_pct,
            "urgent_required_count": urgent_required_count,
            "optional_completed_count": optional_completed_count,
            "last_activity_at": last_activity_at,
        },
    }


def _my_learning_item(r) -> dict:
    completed_ids = json.loads(r["completed_node_ids"]) if r["completed_node_ids"] else []
    status = r["progress_status"] or "not_started"
    page_count = r["page_count"] or 0
    return {
        "id": r["id"],
        "title": r["title"],
        "tags": json.loads(r["tags"]),
        "project_id": r["project_id"],
        "project_name": r["project_name"],
        "is_company_wide": r["is_company_wide"],
        "page_count": page_count,
        "required": r["required"],
        "due_at": r["due_at"],
        "progress_status": status,
        "completed_page_count": len(completed_ids),
        "progress_pct": round(100 * len(completed_ids) / page_count) if page_count else 0,
        "next_action": _next_action(status),
        "completed_at": r["completed_at"],
        "updated_at": r["updated_at"] if "updated_at" in r.keys() else r["progress_updated_at"],
    }


@router.put("/materials/{id}/my-learning")
async def register_my_learning(id: int, user: CurrentUser = Depends(require_auth)):
    """A-89: マイ学習に追加（F-31）。対象教材の受講対象者のみ実行できる
    （_require_view_accessは編集権限保持者・受講対象者の両方を許可するが、実質的には
    S-03に登録ボタンが出るのは受講対象の任意教材のみのため実害は無い）。"""
    pool = get_pool()
    await _require_view_access(pool, id, user)
    await pool.execute(
        """INSERT INTO my_learning_registrations (user_id, material_id) VALUES ($1, $2)
           ON CONFLICT (user_id, material_id) DO NOTHING""",
        user.id, id,
    )
    return {"detail": "マイ学習に追加しました"}


@router.delete("/materials/{id}/my-learning")
async def unregister_my_learning(id: int, user: CurrentUser = Depends(require_auth)):
    """A-89: マイ学習から外す（F-31）。登録が無い場合もエラーにせず成功扱いにする（冪等）。"""
    await get_pool().execute(
        "DELETE FROM my_learning_registrations WHERE user_id = $1 AND material_id = $2",
        user.id, id,
    )
    return {"detail": "マイ学習から外しました"}


class SurveyResponseIn(BaseModel):
    answers: list[dict]


@router.post("/surveys/{survey_id}/responses", status_code=201)
async def submit_survey_response(survey_id: int, body: SurveyResponseIn, user: CurrentUser = Depends(require_auth)):
    """A-72: 受験後アンケートへの回答を送信する（T-28・T-29）。回答は任意でスキップ可能。"""
    pool = get_pool()
    survey = await pool.fetchrow("SELECT material_id FROM surveys WHERE id = $1", survey_id)
    if survey is None:
        raise HTTPException(404, detail="アンケートが見つかりません")
    await _require_view_access(pool, survey["material_id"], user)

    async with pool.acquire() as conn:
        async with conn.transaction():
            response_row = await conn.fetchrow(
                "INSERT INTO survey_responses (survey_id, user_id) VALUES ($1, $2) RETURNING id",
                survey_id, user.id,
            )
            for a in body.answers:
                await conn.execute(
                    "INSERT INTO survey_answers (response_id, survey_question_id, value) VALUES ($1, $2, $3)",
                    response_row["id"], a["survey_question_id"], json.dumps(a["value"]),
                )
    return {"detail": "回答を保存しました"}
