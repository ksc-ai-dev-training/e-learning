# システム設定API（A-55〜A-58, A-80。S-10「管理」システム設定タブ）。
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import slack_client
from auth_helpers import CurrentUser, require_roles
from database import get_pool
from settings_store import (
    DEFAULT_GRACE_PERIOD_DAYS,
    SETTING_KEYS,
    get_ai_model,
    get_setting,
    get_setting_int,
    get_slack_webhook_url,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])

AI_MODEL_CHOICES = {"claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"}


class SettingsUpdate(BaseModel):
    """A-56: 送られてきたキーのみ更新する（部分更新）。"""
    ai_model: str | None = None
    slack_webhook_url: str | None = None
    slack_channel: str | None = None
    project_leave_grace_period_days: int | None = Field(default=None, ge=0, le=365)


@router.get("")
async def get_settings(user: CurrentUser = Depends(require_roles("admin"))):
    """A-55: システム設定の現在値を取得する（T-21に行が無いキーは環境変数・既定値へフォールバック）。"""
    return {
        "ai_model": await get_ai_model() or "claude-sonnet-5",
        "slack_webhook_url": await get_slack_webhook_url() or "",
        "slack_channel": await get_setting("slack_channel") or "",
        "project_leave_grace_period_days": await get_setting_int(
            "project_leave_grace_period_days", DEFAULT_GRACE_PERIOD_DAYS
        ),
    }


@router.put("")
async def update_settings(body: SettingsUpdate, user: CurrentUser = Depends(require_roles("admin"))):
    """A-56: 送られてきたキーのみT-21へupsertする。"""
    updates = body.model_dump(exclude_unset=True)
    if "ai_model" in updates and updates["ai_model"] not in AI_MODEL_CHOICES:
        raise HTTPException(422, detail="ai_modelの値が不正です")

    pool = get_pool()
    for key in SETTING_KEYS:
        if key not in updates:
            continue
        value = updates[key]
        await pool.execute(
            """INSERT INTO app_settings (key, value_text, updated_by, updated_at)
               VALUES ($1, $2, $3, now())
               ON CONFLICT (key) DO UPDATE SET value_text = $2, updated_by = $3, updated_at = now()""",
            key, None if value is None else str(value), user.id,
        )
    return await get_settings(user=user)


@router.post("/slack-test")
async def send_slack_test(user: CurrentUser = Depends(require_roles("admin"))):
    """A-57: 現在設定されているWebhook URLへテスト送信する。"""
    webhook_url = await get_slack_webhook_url()
    if not webhook_url:
        raise HTTPException(502, detail="Slack Webhook URLが設定されていません")
    try:
        await slack_client.send_test_message(webhook_url)
    except httpx.HTTPError:
        raise HTTPException(502, detail="Slackへのテスト送信に失敗しました")
    return {"detail": "テスト送信しました"}


@router.delete("", status_code=204)
async def reset_settings(user: CurrentUser = Depends(require_roles("admin"))):
    """A-80: システム設定を初期状態に戻す（T-21の該当キーを削除し、既定値へフォールバックさせる）。"""
    pool = get_pool()
    await pool.execute("DELETE FROM app_settings WHERE key = ANY($1::text[])", list(SETTING_KEYS))


@router.get("/ai-usage")
async def get_ai_usage(month: str | None = None, user: CurrentUser = Depends(require_roles("admin"))):
    """A-58: 指定月（既定は当月）のAI利用状況を機能別内訳で取得する（基本設計書4.12節・7.2.9節）。
    T-19 ai_usage_logsを集計するのみで新規テーブルは不要。教材の作成・修正（F-05、Claude Code
    CLI連携）は利用者本人の契約で課金されるため、そもそもai_usage_logsに書き込まれず本集計にも
    含まれない。cost_estimate列はai_client.py側で既にJPY換算済みの値のため、追加の通貨換算は
    不要（そのままcost_jpyとして合算する）。"""
    if month is None:
        month = datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        year_str, month_str = month.split("-")
        if len(year_str) != 4 or len(month_str) != 2:
            raise ValueError
        if not (1 <= int(month_str) <= 12):
            raise ValueError
    except ValueError:
        raise HTTPException(422, detail="monthはYYYY-MM形式で指定してください")

    pool = get_pool()
    rows = await pool.fetch(
        """SELECT feature, COUNT(*) AS count,
                  COALESCE(SUM(input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(output_tokens), 0) AS output_tokens,
                  COALESCE(SUM(cost_estimate), 0) AS cost_jpy
           FROM ai_usage_logs
           WHERE created_at >= ($1 || '-01')::timestamptz
             AND created_at < (($1 || '-01')::timestamptz + interval '1 month')
           GROUP BY feature
           ORDER BY feature""",
        month,
    )
    by_feature = [
        {
            "feature": r["feature"],
            "count": r["count"],
            "input_tokens": r["input_tokens"],
            "output_tokens": r["output_tokens"],
            "cost_jpy": float(r["cost_jpy"]),
        }
        for r in rows
    ]
    total = {
        "count": sum(r["count"] for r in by_feature),
        "input_tokens": sum(r["input_tokens"] for r in by_feature),
        "output_tokens": sum(r["output_tokens"] for r in by_feature),
        "cost_jpy": sum(r["cost_jpy"] for r in by_feature),
    }
    return {"month": month, "total": total, "by_feature": by_feature}
