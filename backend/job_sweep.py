# F-20 AI採点・F-22 AI個人フィードバックの滞留ジョブ再実行（詳細設計書08_AI機能実装詳細.html）。
# asyncio.create_taskで起動したジョブがサーバー再起動等で失われた場合の保険として、起動時と
# 5分おきに再走査する。
import asyncio
import logging

from database import get_pool
from routers.learning import _grade_and_store_answer
from routers.reports import run_ai_personal_feedback_job

logger = logging.getLogger("manabi.job_sweep")

SWEEP_INTERVAL_SECONDS = 5 * 60
STUCK_AFTER_MINUTES = 10


async def sweep_once() -> None:
    """submitted_at済みのquiz_attemptsに属し、10分以上is_correct/ai_score_pctがNULLのまま
    放置されている記述式・コード記述式の回答を再採点する（grading_mode='ai'のもののみ）。
    あわせて、10分以上contentがNULLのまま放置されているAI個人フィードバックジョブ（T-17）も
    再実行する（8.3節）。"""
    pool = get_pool()
    rows = await pool.fetch(
        f"""SELECT a.id
            FROM answers a
            JOIN questions q ON q.id = a.question_id
            JOIN quiz_attempts qa ON qa.id = a.attempt_id
            JOIN materials m ON m.id = qa.material_id
            WHERE q.type IN ('free_text', 'code')
              AND a.ai_score_pct IS NULL AND a.is_correct IS NULL
              AND qa.submitted_at IS NOT NULL
              AND qa.submitted_at < now() - interval '{STUCK_AFTER_MINUTES} minutes'
              AND COALESCE(q.grading_mode, m.grading_mode) = 'ai'"""
    )
    if rows:
        logger.info("滞留していたAI採点ジョブを再実行します（%d件）", len(rows))
        for r in rows:
            asyncio.create_task(_grade_and_store_answer(r["id"]))

    feedback_rows = await pool.fetch(
        f"""SELECT id, user_id FROM ai_personal_feedback
            WHERE content IS NULL
              AND requested_at < now() - interval '{STUCK_AFTER_MINUTES} minutes'"""
    )
    if feedback_rows:
        logger.info("滞留していたAI個人フィードバックジョブを再実行します（%d件）", len(feedback_rows))
        for r in feedback_rows:
            asyncio.create_task(run_ai_personal_feedback_job(r["id"], r["user_id"]))


async def run_periodic_sweep() -> None:
    """lifespan中ずっと動き続けるバックグラウンドループ。5分おきに滞留ジョブを再走査する。"""
    while True:
        try:
            await sweep_once()
        except Exception:
            logger.exception("job_sweepの実行中にエラーが発生しました")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
