# システム設定API（A-55〜A-58, A-80。S-10「管理」システム設定タブ）。
# 今回はA-58（AI利用状況取得）のみ実装する。A-55〜A-57・A-80（AIモデル選択・Slack設定・
# 猶予期間・初期化）は次回以降に対応する。
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from auth_helpers import CurrentUser, require_roles
from database import get_pool

router = APIRouter(prefix="/api/settings", tags=["settings"])


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
