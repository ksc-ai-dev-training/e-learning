# システム設定API（A-55〜A-56, A-80。S-10「管理」システム設定タブ）。Slack関連（旧A-57）は
# 個人連携方式（F-12、routers/slack.py）に置き換わったため、システム設定からは撤去した
# （2026-09-03）。
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import ai_client
from auth_helpers import CurrentUser, require_roles
from database import get_pool
from settings_store import DEFAULT_GRACE_PERIOD_DAYS, SETTING_KEYS, get_setting_int

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    """A-56: 送られてきたキーのみ更新する（部分更新）。ai_modelsは機能ごとに固定し、変更操作自体を
    受け付けない（ユーザー指示、2026-09-08。ai_client.FEATURE_MODEL_CONFIG参照）。"""
    project_leave_grace_period_days: int | None = Field(default=None, ge=0, le=365)


@router.get("")
async def get_settings(user: CurrentUser = Depends(require_roles("admin"))):
    """A-55: システム設定の現在値を取得する（T-21に行が無いキーは環境変数・既定値へフォールバック）。
    ai_modelsは機能ごとの現在の使用モデル・reasoning effortを常に固定値で返す（設定不可、
    ai_client.FEATURE_MODEL_CONFIG参照。S-10システム設定タブ「AI利用設定」表示用、2026-09-08）。"""
    return {
        "ai_models": [
            {"feature": feature, "model": cfg["model"], "reasoning_effort": cfg["reasoning_effort"]}
            for feature, cfg in ai_client.FEATURE_MODEL_CONFIG.items()
        ],
        "project_leave_grace_period_days": await get_setting_int(
            "project_leave_grace_period_days", DEFAULT_GRACE_PERIOD_DAYS
        ),
    }


@router.put("")
async def update_settings(body: SettingsUpdate, user: CurrentUser = Depends(require_roles("admin"))):
    """A-56: 送られてきたキーのみT-21へupsertする。"""
    updates = body.model_dump(exclude_unset=True)

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
