# 受講・受験API（A-40〜A-44, A-71〜A-72。詳細設計書7.2.5節）。S-04（目次）・S-16（ページ受講）から呼ばれる。
import asyncio
import json
import logging
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import ai_client
import slack_client
from auth_helpers import CurrentUser, check_project_role, has_active_project_role, require_auth
from database import get_pool
from routers.materials import _count_pages, _fetch_tree, _material_dict, _require_view_access
from settings_store import DEFAULT_GRACE_PERIOD_DAYS, get_setting_int

router = APIRouter(prefix="/api", tags=["learning"])

logger = logging.getLogger("manabi.learning")

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


async def _resolve_assignment_settings(pool, material_id: int) -> dict:
    """合否判定・再受験設定（materials.pass_score_pct・retake_allowed・retake_limit、S-05
    「合否判定・再受験設定」で編集）を取得する。pass_score_pctはNULLのままにもできる任意項目で、
    その場合は「合格基準なし＝スコアによらず常に合格」を意味する（かつてT-11 assignmentsに
    同名のカラムがあったが、配信設定〔S-06〕には対応するUIが無く書き込み経路が一度も実装
    されなかったため、教材全体で1つに決まる設定としてmaterialsへ移設した。2026-09-11、
    ユーザー要望で「合否判定・再受験設定」に実際の編集UIを新設。合否基準・再受験回数上限は
    どちらも必須項目ではなく、無指定（自由に再受験可・常に合格）のままでよい）。"""
    row = await pool.fetchrow(
        "SELECT pass_score_pct, retake_allowed, retake_limit FROM materials WHERE id = $1",
        material_id,
    )
    return {
        "pass_score_pct": float(row["pass_score_pct"]) if row["pass_score_pct"] is not None else None,
        "retake_allowed": row["retake_allowed"],
        "retake_limit": row["retake_limit"],
    }


class StartAttemptIn(BaseModel):
    mode: Literal["graded", "practice"] = "graded"
    scope_node_id: int | None = None
    # 「続きから受講」の再開位置（enrollment_progress.current_node_id）に使う、実際に開いている
    # ページのnode_id。scope_node_idは受験スコープ（教材/章）で、開いているページ自体とは限らない
    # ため別で受け取る。これまでcurrent_node_idはA-41（設問への回答保存）でしか更新されず、
    # 設問の無いページ・まだ何も回答していないページを読んでいる間に離脱すると進捗が一切
    # 記録されない不具合があったため、ページを開くたびに呼ばれるA-40（本APIは毎ページ遷移で
    # 呼ばれる）でも更新できるようにした（2026-09-02）。
    viewing_node_id: int | None = None


@router.post("/materials/{id}/attempts", status_code=201)
async def start_attempt(id: int, body: StartAttemptIn, user: CurrentUser = Depends(require_auth)):
    """A-40: 受験開始。未提出の試行があれば再開し、無ければ新規作成する。ただしmode='graded'で
    そのスコープの直近提出済み記録が合格済みの場合は、新規作成せずその記録を閲覧専用で返す
    （2026-09-03、詳細はfrozen_attempt周りのコメント参照）。
    (user_id, material_id, mode, scope_node_id)の組でsubmitted_at IS NULLな行を高々1件に保つ
    部分ユニークインデックス（uq_quiz_attempts_active）を使い、INSERT ... ON CONFLICT DO UPDATEで
    「無ければ作る・あれば取得する」を1クエリでアトミックに行う。S-16実装時、Reactの開発時
    StrictModeによるページ遷移エフェクトの二重発火で、素朴なSELECTしてから無ければINSERTという
    実装だと同一スコープの未提出試行が2件作られてしまう競合状態を発見し、この方式に修正した。"""
    pool = get_pool()
    perm_row = await _require_view_access(pool, id, user)
    material_row = await pool.fetchrow(
        "SELECT id, project_id, attempt_scope, retake_scope, updated_at, pass_score_pct FROM materials WHERE id = $1",
        id,
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

    # 合格済み、または採点中（未確定）のスコープを開き直しても新規受験記録を作らず、直近の記録を
    # 閲覧専用で返す（2026-09-03、ユーザー指摘。採点中の扱いは2026-09-11追加）。
    # quiz_attemptsの部分ユニークインデックスはsubmitted_at IS NULLの行にしか効かないため、
    # 提出済みスコープを再訪すると素朴には毎回新規の未提出試行が作られてしまい、再受験回数
    # （retake_limit、スコープ単位でカウント）の意図しない消費や、タグ別正答率平均
    # （_aggregate_tag_stats）の水増しにつながっていた。このアプリには専用の「再受験する」ボタンが
    # 無く「開き直す」ことそのものが唯一の再受験手段のため、不合格（かつ採点確定済み）スコープは
    # 今まで通り新規受験記録を作って解き直せるようにし、合格済み・採点中のスコープだけをこの対象から
    # 除外する（スコープ単位判定なので、章単位・小見出し単位の教材で一部合格・一部不合格が混在して
    # いても、それぞれ独立して正しく扱える）。採点中（記述式・コード記述式のAI採点待ち・手動採点待ち）
    # のスコープは合否が未確定のため、再受験（練習は引き続き可能）を認めると採点完了前に何度も
    # 解き直せてしまい、手動採点対象が際限なく増える・どの試行を採点すべきか曖昧になるという問題が
    # あるため、合格済みと同様に新規受験記録の作成をブロックする（2026-09-11）。
    # submitted_at >= materials.updated_atも必須条件にする。教材編集（A-20）でページが追加/変更
    # された後は、編集前の古い合格記録をそのまま再利用してはいけない（新しいページを最後まで読んでも
    # 一切提出されず、completed_node_idsが古いまま固定されて進捗が停滞するバグになっていた。
    # 2026-09-03、開発テスト用教材で発見）。
    # 同様に、A-95「未受講に戻す」はquiz_attempts/answersを消さない方針（学習記録は失われない）
    # のため、リセット後に再受講しても、リセット前の古い合格記録がそのまま再利用されてしまい
    # current_node_idが二度と更新されない（＝「続きから受講」が常に先頭に戻る）不具合があった。
    # enrollment_progress.reset_atより後に提出されたものだけを有効とする（2026-09-03発見）。
    frozen_attempt = None
    if body.mode == "graded":
        reset_at = await pool.fetchval(
            "SELECT reset_at FROM enrollment_progress WHERE user_id = $1 AND material_id = $2",
            user.id, id,
        )
        # 合格基準（pass_score_pct）が未設定の教材は「基準なし＝常に合格」として扱う
        # （_recompute_attempt_result参照）が、この見なし合格は「もう合格したので再受験不要」を
        # 意味しない（そもそも合否の概念が無い教材なので、再受験設定〔retake_allowed・
        # retake_limit〕どおりに何度でも解き直せてよい）。合格基準が実際に設定されている教材でのみ、
        # 合格済みスコープを再受験不可（閲覧専用）にする（2026-09-11、ユーザー報告により発見・修正。
        # 「合格基準なし」を新設した際、既存の合格済みブロックと組み合わせると再受験が事実上
        # 無限に不可能になっていた）。採点中（passed IS NULL）は合否基準の有無に関わらず、
        # 採点完了前の重複受験を防ぐため引き続き閲覧専用にする。
        has_pass_criteria = material_row["pass_score_pct"] is not None
        passed_block_clause = "passed = true" if has_pass_criteria else "false"
        frozen_attempt = await pool.fetchrow(
            f"""SELECT * FROM quiz_attempts
                WHERE user_id = $1 AND material_id = $2 AND mode = 'graded'
                  AND scope_node_id IS NOT DISTINCT FROM $3
                  AND submitted_at IS NOT NULL AND ({passed_block_clause} OR passed IS NULL)
                  AND submitted_at >= $4
                  AND ($5::timestamptz IS NULL OR submitted_at >= $5)
                ORDER BY attempt_no DESC LIMIT 1""",
            user.id, id, scope_node_id, material_row["updated_at"], reset_at,
        )

    if frozen_attempt is not None:
        attempt = dict(frozen_attempt)
        is_new = False
    else:
        # REQ-F-09/F-14: 再受験の可否・回数を教材ごとに定められる、という要求に対し、以前は
        # A-40（本エンドポイント）に一切enforceする処理が無く、実質無制限に解き直せてしまっていた
        # （A-71 /attempts/{id}/retake にはチェックがあったが、フロントエンドから一度も呼ばれない
        # 未使用コードだったため、実際のユーザー導線には反映されていなかった）。ここで実際に
        # チェックする（2026-09-03）。
        # 既に未提出（進行中）の受験記録がある場合は、それを再開するだけ（ON CONFLICTがヒットし
        # 新規行は作られない）なので、再受験回数のチェック対象にしない。新規に行を作る＝実際に
        # 新しい受験（1回目、または不合格後の解き直し）を始める場合のみチェックする。
        if body.mode == "graded":
            has_unsubmitted = await pool.fetchval(
                """SELECT 1 FROM quiz_attempts
                    WHERE user_id = $1 AND material_id = $2 AND mode = 'graded'
                      AND scope_node_id IS NOT DISTINCT FROM $3 AND submitted_at IS NULL""",
                user.id, id, scope_node_id,
            )
            if has_unsubmitted is None:
                settings = await _resolve_assignment_settings(pool, id)
                # attempt_limit_resets: プロジェクトadmin・システムadminがS-12「メンバー管理」から
                # 回数をリセットした時刻。この時刻より後に提出された回数だけを数える
                # （2026-09-03、REQ-F-09対応と合わせて新設）。
                last_reset = await pool.fetchval(
                    """SELECT MAX(reset_at) FROM attempt_limit_resets
                        WHERE user_id = $1 AND material_id = $2 AND scope_node_id IS NOT DISTINCT FROM $3""",
                    user.id, id, scope_node_id,
                )
                submitted_count = await pool.fetchval(
                    """SELECT COUNT(*) FROM quiz_attempts
                        WHERE user_id = $1 AND material_id = $2 AND mode = 'graded'
                          AND scope_node_id IS NOT DISTINCT FROM $3 AND submitted_at IS NOT NULL
                          AND ($4::timestamptz IS NULL OR started_at > $4)""",
                    user.id, id, scope_node_id, last_reset,
                )
                if submitted_count > 0:
                    if not settings["retake_allowed"]:
                        raise HTTPException(400, detail="この教材は再受験できません")
                    if settings["retake_limit"] is not None and submitted_count >= settings["retake_limit"]:
                        raise HTTPException(
                            400,
                            detail="再受験回数の上限に達しています。上限の解除はプロジェクト管理者にご相談ください",
                        )

        attempt_no = await pool.fetchval(
            """SELECT COUNT(*) FROM quiz_attempts
                WHERE user_id = $1 AND material_id = $2 AND mode = $3
                  AND scope_node_id IS NOT DISTINCT FROM $4 AND practice_kind IS NOT DISTINCT FROM $5""",
            user.id, id, body.mode, scope_node_id, practice_kind,
        ) + 1
        question_order = _draw_question_order(pages)
        # 再受験範囲（materials.retake_scope='wrong_only'）: 直近の提出済み記録で正解していた設問は
        # 今回の出題から除外し、carried_over_question_idsに記録する。以前はA-71（フロントエンドから
        # 一度も呼ばれない未使用コード）にしかこの仕組みが実装されておらず、実際の再受験導線である
        # 本APIには一切反映されていなかった（＝「誤答のみ」に設定していても常に全問解き直しに
        # なっていた不具合。2026-09-11、ユーザー報告により発見・修正）。carried_over_question_idsは
        # _recompute_attempt_resultで「出題こそしないが正解として算入する」ために使う。
        carried_over: list[int] = []
        if body.mode == "graded" and material_row["retake_scope"] == "wrong_only":
            prev_attempt = await pool.fetchrow(
                """SELECT id FROM quiz_attempts
                    WHERE user_id = $1 AND material_id = $2 AND mode = 'graded'
                      AND scope_node_id IS NOT DISTINCT FROM $3 AND submitted_at IS NOT NULL
                    ORDER BY attempt_no DESC LIMIT 1""",
                user.id, id, scope_node_id,
            )
            if prev_attempt is not None:
                prev_answers = await pool.fetch(
                    "SELECT question_id, is_correct FROM answers WHERE attempt_id = $1", prev_attempt["id"]
                )
                correct_ids = {a["question_id"] for a in prev_answers if a["is_correct"]}
                carried_over = sorted(correct_ids)
                # 記録型（score_log）は正誤の概念が無くis_correctが常にNULLのため、上のcorrect_idsには
                # 絶対に入らず「誤答のみ」でも毎回出題され続けてしまっていた（2026-09-11、ユーザー報告
                # により発見・修正）。合否判定にも一切算入されない設問なので、正解扱いで繰り越す
                # （carried_over_question_ids）必要も無く、単に今回の出題対象から除外するだけでよい。
                score_log_ids = {
                    q["id"] for page in pages for q in page.get("questions", []) if q["type"] == "score_log"
                }
                question_order = {
                    node_id: [qid for qid in qids if qid not in correct_ids and qid not in score_log_ids]
                    for node_id, qids in question_order.items()
                }
        row = await pool.fetchrow(
            """INSERT INTO quiz_attempts
                   (user_id, material_id, scope_node_id, mode, attempt_no, question_order, practice_kind,
                    carried_over_question_ids)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (user_id, material_id, mode, scope_node_id, practice_kind) WHERE submitted_at IS NULL
               DO UPDATE SET attempt_no = quiz_attempts.attempt_no
               RETURNING *, (xmax = 0) AS inserted""",
            user.id, id, scope_node_id, body.mode, attempt_no, json.dumps(question_order), practice_kind,
            json.dumps(carried_over),
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

    # 提出済み（合格済み・閲覧専用）のスコープを再訪した場合、「誤答のみ」で今回出題しなかった
    # 正解済み設問（carried_over_question_ids）もquestion_orderへ合流させ、その回答も合わせて
    # 返す。そうしないと合格後に見返したとき、実際に解き直した設問しか表示されず、以前から
    # 正解していた設問の回答が見えなくなってしまう（2026-09-11、ユーザー報告により発見・修正）。
    # ページ内の並びは現在のquestions（sort_order順）に揃え、記録型（score_log）は元々「誤答のみ」の
    # 対象外なのでここでも含めない。
    if attempt["submitted_at"] is not None and attempt["carried_over_question_ids"]:
        carried_over_set = set(attempt["carried_over_question_ids"])
        original_ids = {qid for qids in attempt["question_order"].values() for qid in qids}
        full_order: dict[str, list[int]] = {}
        for page in pages:
            ids_this_page = [
                q["id"]
                for q in page.get("questions", [])
                if q["type"] != "score_log" and (q["id"] in original_ids or q["id"] in carried_over_set)
            ]
            if ids_this_page:
                full_order[str(page["id"])] = ids_this_page
        attempt["question_order"] = full_order
        carried_answers = await pool.fetch(
            """SELECT DISTINCT ON (a.question_id) a.question_id, a.response, a.is_correct
               FROM answers a
               JOIN quiz_attempts qa2 ON qa2.id = a.attempt_id
               WHERE a.question_id = ANY($1::bigint[]) AND qa2.user_id = $2 AND qa2.material_id = $3
                 AND qa2.scope_node_id IS NOT DISTINCT FROM $4
               ORDER BY a.question_id, qa2.attempt_no DESC""",
            list(carried_over_set), user.id, id, scope_node_id,
        )
        answers_out.extend(
            {"question_id": r["question_id"], "response": json.loads(r["response"]) if r["response"] else None,
             "is_correct": r["is_correct"]}
            for r in carried_answers
        )

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

    # ページを開いた時点で再開位置を更新する。ただし、既に完了済み（completed_node_idsに
    # 含まれる）ページを後から読み返した場合（S-02「復習する」等）はcurrent_node_idを
    # 巻き戻さないようにする。検証時に判明した点として、attempt_scope='material'の教材を
    # 提出済み後に再度A-40を呼ぶと（ON CONFLICTのWHERE submitted_at IS NULLに一致しないため）
    # 新しいattempt_no・submitted_at=NULLの行が作られてしまい、単純にsubmitted_atだけで
    # 判定すると「提出済み教材の以前のページを読み返す」操作でも真になり巻き戻ってしまう不具合が
    # あったため、completed_node_idsによる判定に変更した（2026-09-02）。
    #
    # 一時visited_node_idsもここで除外していたが、これは誤りだった（2026-09-03に追加→撤回）。
    # 「次へ」を押して閲覧済みになっただけのページは提出済み（completed）ではないため、続きから
    # 受講で自然にそこへ戻ってくること自体は正常な前進であり、current_node_idを更新すべきだった。
    # 除外してしまうと、一度でも閲覧済みになったページには二度とcurrent_node_idが更新されなくなり、
    # 「続きから受講」が古い位置に固定されてしまう不具合になった。目次の✓マークと現在地の青丸が
    # 同じ行で重なる見た目上の問題は、フロントエンド側（MaterialView.tsxのisCurrent算出）で
    # 個別に対処済みのため、バックエンド側でvisited_node_idsを見る必要は無い。
    if body.mode == "graded" and body.viewing_node_id is not None and attempt["submitted_at"] is None:
        progress_row = await pool.fetchrow(
            "SELECT completed_node_ids FROM enrollment_progress WHERE user_id = $1 AND material_id = $2",
            user.id, id,
        )
        completed_ids = (
            set(json.loads(progress_row["completed_node_ids"]))
            if progress_row and progress_row["completed_node_ids"] else set()
        )
        if body.viewing_node_id not in completed_ids:
            await pool.execute(
                """UPDATE enrollment_progress SET current_node_id = $1, updated_at = now()
                    WHERE user_id = $2 AND material_id = $3""",
                body.viewing_node_id, user.id, id,
            )

    return {"attempt": attempt, "toc": tree, "answers": answers_out}


@router.post("/materials/{id}/pages/{node_id}/visit", status_code=204)
async def mark_page_visited(id: int, node_id: int, user: CurrentUser = Depends(require_auth)):
    """A-96: 目次の✓マーク用「閲覧済み」記録。合否判定に使うcompleted_node_idsとは別物で、
    ページの「次へ」を押して読み進めた時点でのみクライアントから呼ばれる（開いた時点では呼ばない）。
    完了率・合否判定の集計には一切使わない、ナビゲーション上の目印専用（2026-09-03、ユーザー要望）。"""
    pool = get_pool()
    await _require_view_access(pool, id, user)
    node_exists = await pool.fetchval(
        "SELECT 1 FROM material_nodes WHERE id = $1 AND material_id = $2", node_id, id
    )
    if node_exists is None:
        raise HTTPException(404, detail="ページが見つかりません")

    row = await pool.fetchrow(
        "SELECT visited_node_ids FROM enrollment_progress WHERE user_id = $1 AND material_id = $2",
        user.id, id,
    )
    existing = set(json.loads(row["visited_node_ids"])) if row and row["visited_node_ids"] else set()
    existing.add(node_id)

    await pool.execute(
        """INSERT INTO enrollment_progress (user_id, material_id, status, visited_node_ids, started_at)
           VALUES ($1, $2, 'in_progress', $3, now())
           ON CONFLICT (user_id, material_id) DO UPDATE
             SET visited_node_ids = $3,
                 status = CASE WHEN enrollment_progress.status = 'not_started' THEN 'in_progress'
                                ELSE enrollment_progress.status END,
                 started_at = COALESCE(enrollment_progress.started_at, now()),
                 updated_at = now()""",
        user.id, id, json.dumps(sorted(existing)),
    )


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
        "SELECT id, node_id, type, correct_answer FROM questions WHERE id = $1 AND material_id = $2",
        body.question_id, attempt["material_id"],
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


async def _recompute_attempt_result(pool, attempt_id: int) -> None:
    """A-42・A-74・_grade_and_store_answer（AI採点完了後）で共通利用する合否再計算処理。"""
    attempt = await pool.fetchrow("SELECT * FROM quiz_attempts WHERE id = $1", attempt_id)
    if attempt is None:
        return
    rows = [
        dict(r)
        for r in await pool.fetch(
            """SELECT a.is_correct, q.type, q.is_critical, q.required, q.counted, q.prompt
               FROM answers a JOIN questions q ON q.id = a.question_id
               WHERE a.attempt_id = $1""",
            attempt_id,
        )
    ]
    # 再受験範囲「誤答のみ」（materials.retake_scope='wrong_only'）で今回出題しなかった、前回正解済みの
    # 設問（carried_over_question_ids）は、このattemptにanswers行を持たないため上のJOINには含まれない。
    # 出題しないだけで合否判定・スコアには引き続き正解として算入する必要があるため、questionsテーブルから
    # 直接取得し、is_correct=Trueの仮想行として合流させる（2026-09-11、「誤答のみ」実装時に対応）。
    carried_over_ids = (
        json.loads(attempt["carried_over_question_ids"]) if attempt["carried_over_question_ids"] else []
    )
    if carried_over_ids:
        carried_rows = await pool.fetch(
            "SELECT type, is_critical, required, counted, prompt FROM questions WHERE id = ANY($1::bigint[])",
            carried_over_ids,
        )
        rows.extend({**dict(r), "is_correct": True} for r in carried_rows)
    # required=false（任意）・counted=false（記録）の設問は、回答してもスコア・合否判定には反映しない
    # （採点・AIフィードバック自体は行われるが、算入されないだけ）。
    gradable = [r for r in rows if r["type"] != "score_log" and r["required"] and r["counted"]]
    # gradable（算入対象）のうち記述式・コード記述式がAI採点待ち・手動採点待ちで1件でも残っている間は
    # score_pct・passedともNULLのまま「採点中」とする（単一選択・複数選択・並び替えは保存時に同期採点
    # されるためis_correctがNULLになるのはAI/手動採点待ちの場合のみ）。この保留を入れず提出直後に
    # 未採点分を不正解扱いして合否を確定していた不具合の修正。
    if any(r["is_correct"] is None for r in gradable):
        await pool.execute(
            "UPDATE quiz_attempts SET score_pct = NULL, passed = NULL, fail_reason = NULL WHERE id = $1",
            attempt_id,
        )
        return
    total = len(gradable)
    correct = sum(1 for r in gradable if r["is_correct"])
    score_pct = (correct / total * 100) if total > 0 else 100.0

    passed = None
    fail_reason = None
    if attempt["mode"] == "graded":
        # ドボン（is_critical）も同様に、任意の設問では自動不合格を発生させない
        # （スコアに反映されない設問がドボンだけ特別扱いで不合格を引き起こすのは矛盾するため）。
        critical_fail = next(
            (r for r in rows if r["is_critical"] and r["required"] and r["counted"] and r["is_correct"] is False), None
        )
        if critical_fail is not None:
            passed = False
            fail_reason = critical_fail["prompt"]
        else:
            settings = await _resolve_assignment_settings(pool, attempt["material_id"])
            # 合格基準（pass_score_pct）が未設定の教材は「基準なし＝スコアによらず常に合格」
            # とする（2026-09-11、ユーザー要望：合否基準を設定しない運用も許容する）。
            passed = True if settings["pass_score_pct"] is None else score_pct >= settings["pass_score_pct"]

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


class AnswerReviewIn(BaseModel):
    is_correct: bool
    ai_feedback: str


@router.put("/answers/{answer_id}/review")
async def review_answer(answer_id: int, body: AnswerReviewIn, user: CurrentUser = Depends(require_auth)):
    """A-74: 設問1件の採点結果を確定・修正する（S-20「採点する」）。grading_mode='ai'の設問
    （AI採点結果の訂正）・'manual'の設問（担当者による新規採点）のいずれも本APIで扱う。
    is_correct・ai_feedback（担当者の講評として保存）を更新し、reviewed_by・reviewed_atを設定する。
    ai_score_pctは変更しない（AIが算出した参考値としてそのまま保持し、人手の判断はis_correctのみで
    表現する）。更新後は_recompute_attempt_resultを呼び、他に未採点が無ければここで合否が確定する
    （「採点中」状態からの確定を含む）。"""
    pool = get_pool()
    row = await pool.fetchrow(
        """SELECT a.attempt_id, m.project_id
           FROM answers a
           JOIN quiz_attempts qa ON qa.id = a.attempt_id
           JOIN materials m ON m.id = qa.material_id
           WHERE a.id = $1""",
        answer_id,
    )
    if row is None:
        raise HTTPException(404, detail="回答が見つかりません")
    await check_project_role(user, row["project_id"], "editor")

    await pool.execute(
        """UPDATE answers SET is_correct = $1, ai_feedback = $2, reviewed_by = $3, reviewed_at = now(),
               updated_at = now()
           WHERE id = $4""",
        body.is_correct, body.ai_feedback, user.id, answer_id,
    )
    await _recompute_attempt_result(pool, row["attempt_id"])
    return {"detail": "採点結果を保存しました"}


def _build_node_path(node_id: int, nodes_by_id: dict) -> str:
    """material_nodesのparent_node_idを根まで辿り、章／小見出し／ページ名を「／」区切りで組み立てる。"""
    titles: list[str] = []
    current = nodes_by_id.get(node_id)
    while current is not None:
        titles.append(current["title"])
        current = nodes_by_id.get(current["parent_node_id"])
    return "／".join(reversed(titles))


@router.get("/grading-queue")
async def get_grading_queue(
    project_id: int | None = None,
    material_id: int | None = None,
    scope: Literal["mine", "all"] = "mine",
    user: CurrentUser = Depends(require_auth),
):
    """A-83: 手動採点の未処理分を横断取得する（S-20）。grading_mode='manual'かつreviewed_by
    未設定の回答を、自分が編集者以上として参加するプロジェクトの範囲で教材ごとにグループ化して返す。
    scope='all'はsystem adminのみ有効（それ以外を指定した場合は無視して'mine'として扱う）。"""
    pool = get_pool()
    effective_scope_all = scope == "all" and user.role == "admin"

    conditions = [
        "q.grading_mode = 'manual'", "a.reviewed_by IS NULL", "qa.submitted_at IS NOT NULL",
        "m.is_archived = false",
    ]
    params: list = []

    def add_param(value) -> str:
        params.append(value)
        return f"${len(params)}"

    if not effective_scope_all:
        ph = add_param(user.id)
        conditions.append(
            f"EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = m.project_id "
            f"AND pm.user_id = {ph} AND pm.status = 'active' AND pm.left_at IS NULL "
            f"AND pm.role IN ('admin', 'editor'))"
        )
    if project_id is not None:
        conditions.append(f"m.project_id = {add_param(project_id)}")
    if material_id is not None:
        conditions.append(f"m.id = {add_param(material_id)}")

    rows = await pool.fetch(
        f"""SELECT a.id AS answer_id, q.id AS question_id, q.prompt, q.node_id,
                   m.id AS material_id, m.title AS material_title, p.name AS project_name,
                   u.name AS user_name, a.response, qa.submitted_at
            FROM answers a
            JOIN questions q ON q.id = a.question_id
            JOIN quiz_attempts qa ON qa.id = a.attempt_id
            JOIN material_nodes n ON n.id = q.node_id
            JOIN materials m ON m.id = n.material_id
            JOIN projects p ON p.id = m.project_id
            JOIN users u ON u.id = qa.user_id
            WHERE {" AND ".join(conditions)}
            ORDER BY m.id, qa.submitted_at""",
        *params,
    )

    material_ids = {r["material_id"] for r in rows}
    nodes_by_id: dict[int, dict] = {}
    if material_ids:
        node_rows = await pool.fetch(
            "SELECT id, parent_node_id, title FROM material_nodes WHERE material_id = ANY($1::bigint[])",
            list(material_ids),
        )
        nodes_by_id = {n["id"]: n for n in node_rows}

    materials: dict[int, dict] = {}
    for r in rows:
        m = materials.setdefault(
            r["material_id"],
            {
                "material_id": r["material_id"],
                "material_title": r["material_title"],
                "project_name": r["project_name"],
                "pending_count": 0,
                "answers": [],
            },
        )
        m["pending_count"] += 1
        m["answers"].append({
            "answer_id": r["answer_id"],
            "question_id": r["question_id"],
            "node_path": _build_node_path(r["node_id"], nodes_by_id),
            "prompt": r["prompt"],
            "user_name": r["user_name"],
            "response_excerpt": json.loads(r["response"]) if r["response"] else "",
            "submitted_at": r["submitted_at"],
        })

    total_pending = len(rows)
    oldest_submitted_at = min((r["submitted_at"] for r in rows), default=None)
    return {
        "summary": {
            "total_pending": total_pending,
            "material_count": len(materials),
            "oldest_submitted_at": oldest_submitted_at,
        },
        "materials": list(materials.values()),
    }


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
        # _scope_groups は attempt_scope='section' のとき、実際のsectionノードに加えて
        # 小見出しの無い章直下ページ用の章フォールバック群も返す（A-86と同じロジックを再利用）。
        # 以前はここだけ_collect_nodes_of_kindで実際のsectionノードしか見ておらず、小見出しの無い
        # 章の合否が完了判定から漏れていた（2026-09-02、コードレビューで発見・修正）。
        group_nodes = _scope_groups(tree, attempt_scope)
        is_complete = True
        for g in group_nodes:
            latest = await pool.fetchrow(
                """SELECT passed FROM quiz_attempts
                    WHERE user_id = $1 AND material_id = $2 AND scope_node_id = $3
                      AND mode = 'graded' AND submitted_at IS NOT NULL
                    ORDER BY attempt_no DESC LIMIT 1""",
                user_id, material_id, g["scope_node_id"],
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
        if not await has_active_project_role(material["project_id"], user.id, "editor"):
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
    if prev["mode"] != "graded":
        raise HTTPException(400, detail="本受験（graded）の記録のみ再受験できます")
    if prev["passed"] is None:
        raise HTTPException(400, detail="採点が完了するまで再受験できません（反復演習は利用できます）")

    material = await pool.fetchrow("SELECT * FROM materials WHERE id = $1", prev["material_id"])
    settings = await _resolve_assignment_settings(pool, prev["material_id"])
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
    """A-44: 誤答＆難問抽出出題を開始する（mode='practice'。合否・ドボン判定は行わない）。
    自分の直近の誤答に加え、自分が解答したことのある設問のうち全受講者の正答率が50%未満の
    ものも対象に含める（scope='all'の場合、自分が一度も解いたことのない教材の低正答率設問まで
    無条件に混ざり込み、全社wiki等の教材が増えるほど無関係な問題が際限なく増えてしまうため、
    2026-09-10、自分の解答履歴がある設問に限定する形へ変更）。"""
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

    if body.scope == "material":
        low_rate_filter = "AND q.material_id = $1"
        low_rate_params = [id, user.id]
        user_param = "$2"
    else:
        low_rate_filter = ""
        low_rate_params = [user.id]
        user_param = "$1"
    low_rate = await pool.fetch(
        f"""SELECT a.question_id FROM answers a
            JOIN questions q ON q.id = a.question_id
            WHERE a.is_correct IS NOT NULL {low_rate_filter}
            GROUP BY a.question_id
            HAVING AVG(a.is_correct::int) < 0.5
               AND EXISTS (
                 SELECT 1 FROM answers ua
                 JOIN quiz_attempts uqa ON uqa.id = ua.attempt_id
                 WHERE ua.question_id = a.question_id AND uqa.user_id = {user_param}
               )""",
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
    """A-86: S-04「前回の受験結果パネル」「採点結果パネル」向け。attempt_scopeで定まる
    スコープ群ごとに、自分の最新graded試行（提出済みのもの。無ければそのスコープは省略する）と、
    その回答（記録型を除く全種別。AI講評込み）をまとめて返す（2026-09-11、選択式が除外されていた
    不具合を修正し、手動採点結果も同じ仕組みで表示するようパネル名を「採点結果」に改称した）。"""
    pool = get_pool()
    await _require_view_access(pool, id, user)
    material = await pool.fetchrow("SELECT * FROM materials WHERE id = $1", id)
    tree = await _fetch_tree(pool, id, strip_answers=True)
    groups = _scope_groups(tree, material["attempt_scope"])
    settings = await _resolve_assignment_settings(pool, id)

    entries = []
    for g in groups:
        attempt = await pool.fetchrow(
            """SELECT id, attempt_no, score_pct, passed, fail_reason, submitted_at, carried_over_question_ids
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
            """SELECT a.question_id, q.prompt, q.type, a.response, a.is_correct, a.ai_score_pct, a.ai_feedback
               FROM answers a JOIN questions q ON q.id = a.question_id
               WHERE a.attempt_id = $1 AND q.type != 'score_log'""",
            attempt["id"],
        )
        # 再受験範囲「誤答のみ」で今回は出題しなかった、前回までに正解済みの設問
        # （carried_over_question_ids）は、このattemptにanswers行が無いため上のクエリに含まれない。
        # 採点結果パネルの正答率表示と実際に並ぶ設問数が食い違って見えないよう、この受講者の同じ
        # スコープの過去attemptから、その設問の直近の回答を拾って合流させる（2026-09-11、
        # 「誤答のみ」実装時に対応）。
        carried_over_ids = (
            json.loads(attempt["carried_over_question_ids"]) if attempt["carried_over_question_ids"] else []
        )
        if carried_over_ids:
            carried_answers = await pool.fetch(
                """SELECT DISTINCT ON (a.question_id)
                          a.question_id, q.prompt, q.type, a.response, a.is_correct, a.ai_score_pct, a.ai_feedback
                   FROM answers a
                   JOIN questions q ON q.id = a.question_id
                   JOIN quiz_attempts qa2 ON qa2.id = a.attempt_id
                   WHERE a.question_id = ANY($1::bigint[]) AND qa2.user_id = $2 AND qa2.material_id = $3
                     AND qa2.scope_node_id IS NOT DISTINCT FROM $4
                   ORDER BY a.question_id, qa2.attempt_no DESC""",
                carried_over_ids, user.id, id, g["scope_node_id"],
            )
            answers = list(answers) + list(carried_answers)
        # q.sort_orderはページ内でのローカルな並び順（ページごとに0から始まる）のため、単独で
        # ORDER BYすると複数ページにまたがるスコープ（例: attempt_scope='material'）で他ページの
        # 設問と番号が衝突し、表示順がページをまたいで入れ替わってしまう不具合があった
        # （2026-09-11、ユーザー報告により発見）。ページの並び（tree）→ページ内のsort_orderという
        # 実際の出題順どおりに並べ直す。
        pages = _scope_pages(tree, material["attempt_scope"], g["scope_node_id"])
        order_index = {
            q["id"]: i
            for i, q in enumerate(q for page in pages for q in page.get("questions", []))
        }
        answers = sorted(answers, key=lambda a: order_index.get(a["question_id"], len(order_index)))
        answer_dicts = []
        for a in answers:
            d = dict(a)
            d["response"] = json.loads(d["response"]) if d["response"] else None
            answer_dicts.append(d)
        entries.append({
            "scope_node_id": g["scope_node_id"],
            "scope_label": g["label"],
            "attempt": dict(attempt),
            "attempt_count": attempt_count,
            "retake_allowed": settings["retake_allowed"],
            "retake_limit": settings["retake_limit"],
            "answers": answer_dicts,
        })
    return {"items": entries}


async def _require_project_admin(project_id: int, user: CurrentUser) -> None:
    """このプロジェクトのadmin、またはシステムadminのみ許可する（個人学習レポートの管理者判定
    〔is_manager_of_target_user〕と同じ基準）。全社Wikiは構造上adminロールを誰にも付与できない
    ため、editorには決して以下の受験状況・回数リセットを見せない（2026-09-03、ユーザー指摘）。"""
    if user.role == "admin":
        return
    if not await has_active_project_role(project_id, user.id, min_role="admin"):
        raise HTTPException(403, detail="この操作を行う権限がありません")


@router.get("/projects/{project_id}/members/{user_id}/attempts")
async def get_member_attempt_status(
    project_id: int, user_id: int, user: CurrentUser = Depends(require_auth)
):
    """新設: S-12「メンバー管理」タブの「受験状況」パネル向け。対象メンバーがこのプロジェクトの
    教材で行ったgraded受験を、スコープ（教材全体/章/小見出し/ページ）単位で一覧表示する
    （REQ-F-09の再受験回数上限・リセットの前提情報。2026-09-03新設）。"""
    await _require_project_admin(project_id, user)
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT DISTINCT qa.material_id, qa.scope_node_id, m.title AS material_title, m.attempt_scope
           FROM quiz_attempts qa
           JOIN materials m ON m.id = qa.material_id
           WHERE m.project_id = $1 AND qa.user_id = $2 AND qa.mode = 'graded'
           ORDER BY qa.material_id, qa.scope_node_id""",
        project_id, user_id,
    )
    items = []
    tree_cache: dict[int, list[dict]] = {}
    for r in rows:
        material_id = r["material_id"]
        if material_id not in tree_cache:
            tree_cache[material_id] = await _fetch_tree(pool, material_id, strip_answers=True)
        groups = _scope_groups(tree_cache[material_id], r["attempt_scope"])
        matching_group = next((g for g in groups if g["scope_node_id"] == r["scope_node_id"]), None)
        if matching_group is None:
            # 過去に受験単位（attempt_scope）の設定が変更された場合、古い設定の下で作られた
            # quiz_attempts.scope_node_idが現在の設定に対応するスコープ群のどれとも一致しなく
            # なることがある（例: 章単位→教材全体に変更した後も、章単位時代のnode_idが残る）。
            # そうした孤立データは現在の受験状況としては無効なので一覧から除外する（回数制限の
            # 判定自体はA-40側で現在のscope_node_idのみを見ているため、これは表示上の問題であり
            # 回数の水増しにはならない。2026-09-03、ユーザー指摘で発見）。
            continue
        label = matching_group["label"]
        latest = await pool.fetchrow(
            """SELECT score_pct, passed FROM quiz_attempts
                WHERE user_id = $1 AND material_id = $2 AND mode = 'graded'
                  AND scope_node_id IS NOT DISTINCT FROM $3 AND submitted_at IS NOT NULL
                ORDER BY attempt_no DESC LIMIT 1""",
            user_id, material_id, r["scope_node_id"],
        )
        last_reset = await pool.fetchval(
            """SELECT MAX(reset_at) FROM attempt_limit_resets
                WHERE user_id = $1 AND material_id = $2 AND scope_node_id IS NOT DISTINCT FROM $3""",
            user_id, material_id, r["scope_node_id"],
        )
        submitted_count = await pool.fetchval(
            """SELECT COUNT(*) FROM quiz_attempts
                WHERE user_id = $1 AND material_id = $2 AND mode = 'graded'
                  AND scope_node_id IS NOT DISTINCT FROM $3 AND submitted_at IS NOT NULL
                  AND ($4::timestamptz IS NULL OR started_at > $4)""",
            user_id, material_id, r["scope_node_id"], last_reset,
        )
        settings = await _resolve_assignment_settings(pool, material_id)
        items.append({
            "material_id": material_id,
            "material_title": r["material_title"],
            "scope_node_id": r["scope_node_id"],
            "scope_label": label,
            "score_pct": float(latest["score_pct"]) if latest and latest["score_pct"] is not None else None,
            "passed": latest["passed"] if latest else None,
            "submitted_count": submitted_count,
            "retake_allowed": settings["retake_allowed"],
            "retake_limit": settings["retake_limit"],
            "last_reset_at": last_reset,
        })
    return {"items": items}


class AttemptResetIn(BaseModel):
    material_id: int
    scope_node_id: int | None = None


@router.post("/projects/{project_id}/members/{user_id}/attempts/reset", status_code=204)
async def reset_attempt_limit(
    project_id: int, user_id: int, body: AttemptResetIn, user: CurrentUser = Depends(require_auth)
):
    """新設: 再受験回数の上限リセット。quiz_attempts/answers（学習記録）自体は削除せず、以後の
    回数カウントをこの時刻より後の提出のみに限定する（2026-09-03、S-12「メンバー管理」向け）。"""
    await _require_project_admin(project_id, user)
    pool = get_pool()
    material_row = await pool.fetchrow("SELECT project_id FROM materials WHERE id = $1", body.material_id)
    if material_row is None or material_row["project_id"] != project_id:
        raise HTTPException(404, detail="教材が見つかりません")
    await pool.execute(
        """INSERT INTO attempt_limit_resets (user_id, material_id, scope_node_id, reset_by)
           VALUES ($1, $2, $3, $4)""",
        user_id, body.material_id, body.scope_node_id, user.id,
    )


async def _fetch_overdue_required(pool, project_id: int, user_id: int) -> list[dict]:
    """F-11: 対象ユーザーの、このプロジェクトの必修教材のうち期限が近い（7日以内）または
    超過していて未完了のものを列挙する（A-39の urgent_required_count と同じ「7日以内」基準）。"""
    rows = await pool.fetch(
        """SELECT m.id AS material_id, m.title AS material_title, asg.due_at
           FROM materials m
           JOIN LATERAL (
               SELECT due_at FROM assignments a
                WHERE a.material_id = m.id AND a.required = true
                  AND ((a.scope_type = 'project' AND a.scope_id = m.project_id)
                       OR (a.scope_type = 'individual' AND a.scope_id = $2))
                ORDER BY due_at ASC NULLS LAST LIMIT 1
           ) asg ON true
           LEFT JOIN enrollment_progress ep ON ep.material_id = m.id AND ep.user_id = $2
           WHERE m.project_id = $1 AND m.status = 'published' AND m.is_archived = false
             AND asg.due_at IS NOT NULL AND asg.due_at <= now() + interval '7 days'
             AND COALESCE(ep.status, 'not_started') != 'completed'
           ORDER BY asg.due_at ASC""",
        project_id, user_id,
    )
    return [dict(r) for r in rows]


@router.get("/projects/{project_id}/members/{user_id}/overdue-required")
async def get_member_overdue_required(
    project_id: int, user_id: int, user: CurrentUser = Depends(require_auth)
):
    """新設（F-11）: S-12「メンバー管理」向け。対象メンバーの、このプロジェクトの必修教材のうち
    期限が近い・超過していて未完了のものを一覧する（2026-09-03、REQ-F-08対応）。個別の催促は
    Manabiでは自動化せず、この一覧を見た管理者が運用で直接連絡する方針（2026-09-04）。"""
    await _require_project_admin(project_id, user)
    pool = get_pool()
    items = await _fetch_overdue_required(pool, project_id, user_id)
    return {"items": items}


async def _fetch_project_overdue_required_summary(pool, project_id: int) -> list[dict]:
    """F-12（プロジェクト単位のSlackリマインド用）: このプロジェクトの必修教材のうち、期限が
    近い（7日以内）または超過していて未完了のメンバーが1人以上いるものを、教材ごとに未完了人数を
    集計して列挙する（個人名は含めない。個人単位の状況は_fetch_overdue_required〔S-12メンバー
    管理〕で確認する）。scope_type='individual'の個別期限は対象外（プロジェクト全体向けの概況
    通知のため、プロジェクトスコープの期限のみを見る。2026-09-04）。"""
    rows = await pool.fetch(
        """SELECT m.id AS material_id, m.title AS material_title, a.due_at,
                  COUNT(*) FILTER (
                      WHERE COALESCE(ep.status, 'not_started') != 'completed'
                  ) AS incomplete_count
           FROM materials m
           JOIN assignments a ON a.material_id = m.id AND a.required = true
                AND a.scope_type = 'project' AND a.scope_id = m.project_id
           JOIN project_memberships pm ON pm.project_id = m.project_id
                AND pm.status = 'active' AND pm.left_at IS NULL
           LEFT JOIN enrollment_progress ep ON ep.material_id = m.id AND ep.user_id = pm.user_id
           WHERE m.project_id = $1 AND m.status = 'published' AND m.is_archived = false
             AND a.due_at IS NOT NULL AND a.due_at <= now() + interval '7 days'
           GROUP BY m.id, m.title, a.due_at
           HAVING COUNT(*) FILTER (WHERE COALESCE(ep.status, 'not_started') != 'completed') > 0
           ORDER BY a.due_at ASC""",
        project_id,
    )
    return [dict(r) for r in rows]


@router.post("/projects/{project_id}/slack-remind")
async def send_project_slack_reminder(project_id: int, user: CurrentUser = Depends(require_auth)):
    """新設（F-12）: プロジェクトの必修教材について、未受講者数を教材単位で集計し、このプロジェクト
    に登録されたSlack Webhook URL（projects.slack_webhook_url）宛てにまとめて通知する。個人名は
    含めず、個人ごとの催促は運用（担当者が直接連絡）でカバーする方針（2026-09-04、検討資料/
    20260903_Slack連携方式比較.html参照）。"""
    await _require_project_admin(project_id, user)
    pool = get_pool()
    project_row = await pool.fetchrow("SELECT name, slack_webhook_url FROM projects WHERE id = $1", project_id)
    if project_row is None:
        raise HTTPException(404, detail="プロジェクトが見つかりません")
    if not project_row["slack_webhook_url"]:
        raise HTTPException(400, detail="このプロジェクトにはSlack Webhook URLが設定されていません")

    items = await _fetch_project_overdue_required_summary(pool, project_id)
    if not items:
        raise HTTPException(400, detail="リマインド対象の未受講の必修教材がありません")

    lines = [f"「{project_row['name']}」の必修教材で、受講期限が近い・過ぎているものがあります。"]
    for it in items:
        due_label = it["due_at"].strftime("%Y-%m-%d") if it["due_at"] else "期限未設定"
        lines.append(f"・{it['material_title']}（期限: {due_label}、未受講 {it['incomplete_count']}名）")
    frontend_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    lines.append(f"{frontend_url}/ からマイ学習を確認してください。" if frontend_url else "Manabiのマイ学習から確認してください。")

    try:
        await slack_client.send_webhook_message(project_row["slack_webhook_url"], "\n".join(lines))
    except Exception:
        logger.exception("event=slack_remind_failed project_id=%s", project_id)
        raise HTTPException(502, detail="Slackへの送信に失敗しました（Webhook URLが無効な可能性があります）")
    return {"detail": "送信しました"}


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
                    WHERE a.attempt_id = qa.id AND q.type != 'score_log' AND q.required AND q.counted) AS total_count,
                  (SELECT COUNT(*) FROM answers a JOIN questions q ON q.id = a.question_id
                    WHERE a.attempt_id = qa.id AND q.type != 'score_log' AND q.required AND q.counted AND a.is_correct = true) AS correct_count
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
                      ep.status AS progress_status, ep.completed_node_ids, ep.visited_node_ids, ep.completed_at,
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

    grace_days = await get_setting_int("project_leave_grace_period_days", DEFAULT_GRACE_PERIOD_DAYS)
    rows = await pool.fetch(
        """SELECT m.id, m.title, m.tags, m.project_id, p.name AS project_name, p.is_company_wide,
                  COALESCE(nc.page_count, 0) AS page_count,
                  COALESCE(asg.required, false) AS required, asg.due_at,
                  ep.status AS progress_status, ep.completed_node_ids, ep.visited_node_ids, ep.completed_at,
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
                       AND pm.user_id = $1 AND pm.status = 'active'
                       AND (pm.left_at IS NULL OR pm.left_at + ($2 * interval '1 day') >= now()))
               OR EXISTS (SELECT 1 FROM assignments ia WHERE ia.material_id = m.id
                          AND ia.scope_type = 'individual' AND ia.scope_id = $1)
             )""",
        user.id, grace_days,
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

    # 採点結果未確認: 本人の回答がreviewed_at設定済み（手動採点・AI採点の訂正いずれも含む）だが
    # まだresult_seen_atで確認済みにしていない（またはreviewed_atより後にまだ確認していない＝
    # 確認後に採点し直された）教材を一覧する。S-04の採点結果パネルを開くとA-98で確認済みになる
    # （2026-09-11新設）。
    pending_review_rows = await pool.fetch(
        """SELECT m.id, m.title, m.tags, m.project_id, p.name AS project_name, p.is_company_wide,
                  COALESCE(nc.page_count, 0) AS page_count,
                  COALESCE(asg.required, false) AS required, asg.due_at,
                  ep.status AS progress_status, ep.completed_node_ids, ep.visited_node_ids, ep.completed_at,
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
             AND EXISTS (
               SELECT 1 FROM answers a JOIN quiz_attempts qa ON qa.id = a.attempt_id
               WHERE qa.user_id = $1 AND qa.material_id = m.id AND a.reviewed_at IS NOT NULL
                 AND (a.result_seen_at IS NULL OR a.result_seen_at < a.reviewed_at)
           )""",
        user.id,
    )
    pending_review_items = [_my_learning_item(r) for r in pending_review_rows]

    return {
        "required": required_items,
        "optional": optional_items,
        "pending_review": pending_review_items,
        "stats": {
            "required_completion_pct": required_completion_pct,
            "completed_required_count": completed_required,
            "total_required_count": total_required,
            "urgent_required_count": urgent_required_count,
            "optional_completed_count": optional_completed_count,
            "last_activity_at": last_activity_at,
        },
    }


def _my_learning_item(r) -> dict:
    completed_ids = json.loads(r["completed_node_ids"]) if r["completed_node_ids"] else []
    # 進捗率（progress_pct）は「進んだページ」ベースで出す。attempt_scope='material'等の
    # 教材はcompleted_node_idsが最後まで提出するまで一切増えず0%→100%の一足飛びになって
    # しまうため、visited_node_ids（A-96、「次へ」を押して読み進めた実績）も合わせて分母に
    # 数える（2026-09-03、ユーザー要望）。completed_page_count自体は引き続き提出済み数のみ
    # を表す別指標として残す。
    visited_ids = json.loads(r["visited_node_ids"]) if r["visited_node_ids"] else []
    reached_ids = set(completed_ids) | set(visited_ids)
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
        "progress_pct": round(100 * len(reached_ids) / page_count) if page_count else 0,
        "next_action": _next_action(status),
        "completed_at": r["completed_at"],
        "updated_at": r["updated_at"] if "updated_at" in r.keys() else r["progress_updated_at"],
    }


@router.post("/materials/{id}/grading-results/ack")
async def ack_grading_results(id: int, user: CurrentUser = Depends(require_auth)):
    """A-98: 採点結果の確認済み化。本人のこの教材内の回答のうち、reviewed_at設定済み
    （手動採点・AI採点の訂正いずれも含む）だがまだ確認済みにしていない行をresult_seen_at=now()に
    更新する。マイ学習「採点結果未確認」ボックス（A-39）から対象教材を外すためのもの。本人の行しか
    更新しないため教材へのアクセス権限チェックは不要（A-95と同じ考え方）。"""
    pool = get_pool()
    await pool.execute(
        """UPDATE answers SET result_seen_at = now()
           WHERE id IN (
               SELECT a.id FROM answers a JOIN quiz_attempts qa ON qa.id = a.attempt_id
               WHERE qa.user_id = $1 AND qa.material_id = $2 AND a.reviewed_at IS NOT NULL
                 AND (a.result_seen_at IS NULL OR a.result_seen_at < a.reviewed_at)
           )""",
        user.id, id,
    )
    return {"detail": "確認済みにしました"}


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
    """A-72: 受講後アンケートへの回答を送信する（T-28・T-29）。回答は任意でスキップ可能。"""
    pool = get_pool()
    survey = await pool.fetchrow("SELECT material_id FROM surveys WHERE id = $1", survey_id)
    if survey is None:
        raise HTTPException(404, detail="アンケートが見つかりません")
    await _require_view_access(pool, survey["material_id"], user)

    valid_question_ids = {
        r["id"] for r in await pool.fetch("SELECT id FROM survey_questions WHERE survey_id = $1", survey_id)
    }
    for a in body.answers:
        if a["survey_question_id"] not in valid_question_ids:
            raise HTTPException(422, detail="survey_question_idがこのアンケートの設問ではありません")

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
