# 受験・採点（backend/routers/learning.py）の自動テスト。過去に何度もユーザー報告で発覚した
# 不具合のあった領域（合否判定・ドボン設問・再受験回数の上限・「誤答のみ」の繰り越し・
# 学習履歴からの削除が再受験回数に影響しないこと）をカバーする。
#
# HTTP層を経由せず、router関数を直接呼び出す（本番調査時にMCP経由で使っているのと同じやり方。
# CurrentUserを自分で組み立てて渡すだけでよく、Depends()解決やCookie/JWTのセットアップが不要）。
from fastapi import HTTPException

from routers.learning import (
    SaveAnswerIn,
    StartAttemptIn,
    delete_material_history,
    get_attempt_summary,
    save_answer,
    start_attempt,
    submit_attempt,
)


async def _answer_and_submit(user, attempt, answers: dict[int, str]):
    """attempt内の指定した設問に回答し、提出する。answersは{question_id: response}。"""
    attempt_id = attempt["id"]
    for question_id, response in answers.items():
        await save_answer(attempt_id, SaveAnswerIn(question_id=question_id, response=response), user=user)
    return await submit_attempt(attempt_id, user=user)


async def test_pass_fail_and_score_pct(make_user, make_project, make_material, make_question):
    """2問中1問正解 → 50点・pass_score_pct=70に届かず不合格になることを確認する。"""
    user = await make_user()
    project_id = await make_project(user)
    mat = await make_material(project_id, user.id, pass_score_pct=70.0)
    q1 = await make_question(mat["material_id"], mat["page_node_id"], sort_order=0)
    q2 = await make_question(mat["material_id"], mat["page_node_id"], sort_order=1)

    res = await start_attempt(mat["material_id"], StartAttemptIn(mode="graded"), user=user)
    result = await _answer_and_submit(user, res["attempt"], {q1: "correct", q2: "wrong"})

    assert result["score_pct"] == 50
    assert result["passed"] is False


async def test_all_correct_passes(make_user, make_project, make_material, make_question):
    user = await make_user()
    project_id = await make_project(user)
    mat = await make_material(project_id, user.id, pass_score_pct=70.0)
    q1 = await make_question(mat["material_id"], mat["page_node_id"], sort_order=0)
    q2 = await make_question(mat["material_id"], mat["page_node_id"], sort_order=1)

    res = await start_attempt(mat["material_id"], StartAttemptIn(mode="graded"), user=user)
    result = await _answer_and_submit(user, res["attempt"], {q1: "correct", q2: "correct"})

    assert result["score_pct"] == 100
    assert result["passed"] is True


async def test_is_critical_forces_fail_even_above_threshold(make_user, make_project, make_material, make_question):
    """ドボン設問（is_critical）に不正解だと、全体スコアが合格基準以上でも不合格になることを確認する。"""
    user = await make_user()
    project_id = await make_project(user)
    mat = await make_material(project_id, user.id, pass_score_pct=50.0)
    critical_q = await make_question(mat["material_id"], mat["page_node_id"], sort_order=0, is_critical=True)
    normal_q = await make_question(mat["material_id"], mat["page_node_id"], sort_order=1)

    res = await start_attempt(mat["material_id"], StartAttemptIn(mode="graded"), user=user)
    result = await _answer_and_submit(user, res["attempt"], {critical_q: "wrong", normal_q: "correct"})

    # 素点は50%（合格基準ちょうど）だが、ドボン設問の不正解が優先して不合格にする
    assert result["score_pct"] == 50
    assert result["passed"] is False
    assert result["fail_reason"] == "設問0"


async def test_retake_limit_blocks_after_reaching_limit(make_user, make_project, make_material, make_question):
    """retake_limit=1の教材で、1回不合格になった後の再受験がブロックされることを確認する。"""
    user = await make_user()
    project_id = await make_project(user)
    mat = await make_material(project_id, user.id, pass_score_pct=100.0, retake_allowed=True, retake_limit=1)
    q1 = await make_question(mat["material_id"], mat["page_node_id"], sort_order=0)

    res = await start_attempt(mat["material_id"], StartAttemptIn(mode="graded"), user=user)
    result = await _answer_and_submit(user, res["attempt"], {q1: "wrong"})
    assert result["passed"] is False

    try:
        await start_attempt(mat["material_id"], StartAttemptIn(mode="graded"), user=user)
        assert False, "再受験回数の上限に達しているのにHTTPExceptionが発生しなかった"
    except HTTPException as e:
        assert e.status_code == 400


async def test_wrong_only_carries_over_correct_answers(make_user, make_project, make_material, make_question):
    """retake_scope='wrong_only'で、前回正解した設問が再受験の出題から除外され、
    かつ合否判定には正解として算入され続けることを確認する（2026-09-11に実装された仕様）。"""
    user = await make_user()
    project_id = await make_project(user)
    mat = await make_material(
        project_id, user.id, pass_score_pct=100.0, retake_scope="wrong_only", retake_allowed=True,
    )
    q1 = await make_question(mat["material_id"], mat["page_node_id"], sort_order=0)
    q2 = await make_question(mat["material_id"], mat["page_node_id"], sort_order=1)

    res1 = await start_attempt(mat["material_id"], StartAttemptIn(mode="graded"), user=user)
    result1 = await _answer_and_submit(user, res1["attempt"], {q1: "correct", q2: "wrong"})
    assert result1["passed"] is False

    res2 = await start_attempt(mat["material_id"], StartAttemptIn(mode="graded"), user=user)
    question_order = res2["attempt"]["question_order"]
    page_questions = question_order.get(str(mat["page_node_id"]), [])
    # 前回正解済みのq1は出題されず、不正解だったq2のみが出題される
    assert page_questions == [q2]

    result2 = await _answer_and_submit(user, res2["attempt"], {q2: "correct"})
    # q1は出題されていないが、carried_over_question_idsにより正解として算入され100点で合格する
    assert result2["score_pct"] == 100
    assert result2["passed"] is True


async def test_deleted_history_still_counts_toward_retake_limit(
    make_user, make_project, make_material, make_question, pool,
):
    """「学習履歴から削除」（A-102）は表示上の履歴を隠すだけで、再受験回数の上限判定には
    一切影響しないことを確認する（backend/database.pyのdeleted_at設計判断コメント参照）。"""
    user = await make_user()
    project_id = await make_project(user)
    mat = await make_material(project_id, user.id, pass_score_pct=100.0, retake_allowed=True, retake_limit=1)
    q1 = await make_question(mat["material_id"], mat["page_node_id"], sort_order=0)

    res = await start_attempt(mat["material_id"], StartAttemptIn(mode="graded"), user=user)
    await _answer_and_submit(user, res["attempt"], {q1: "wrong"})

    await delete_material_history(mat["material_id"], user=user)

    # 削除後もquiz_attempts行自体は残り、deleted_atだけが立っている
    row = await pool.fetchrow(
        "SELECT deleted_at FROM quiz_attempts WHERE id = $1", res["attempt"]["id"],
    )
    assert row["deleted_at"] is not None

    # 学習履歴からは見えなくなる（S-04採点結果パネル・S-09学習履歴が使うAPI）
    summary = await get_attempt_summary(mat["material_id"], user=user)
    assert summary["items"] == []

    # それでも再受験回数の上限判定は削除前と変わらずブロックしたままになる
    try:
        await start_attempt(mat["material_id"], StartAttemptIn(mode="graded"), user=user)
        assert False, "学習履歴削除後に再受験回数の上限が無視されてしまっている"
    except HTTPException as e:
        assert e.status_code == 400
