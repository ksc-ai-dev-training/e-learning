# T-21 app_settings（システム設定）の読み取り専用ヘルパー。auth_helpers.py（プロジェクト離任後の
# 猶予期間判定、5.5節）・routers/settings.py（A-55〜A-56・A-80）の両方がこれを経由する。
# routers/settings.pyからauth_helpers.pyを参照すると循環importになるため、どこからも参照されない
# 独立モジュールとして切り出した。AIモデルはコスト管理のため常に最安モデルに固定しており
# （ai_client.DEFAULT_MODEL）、Slackは個人連携方式（routers/slack.py）に置き換わったため、
# どちらもここでは扱わない（2026-09-03）。
from __future__ import annotations

from database import get_pool

SETTING_KEYS = ("project_leave_grace_period_days",)
DEFAULT_GRACE_PERIOD_DAYS = 30


async def get_setting(key: str) -> str | None:
    row = await get_pool().fetchrow("SELECT value_text FROM app_settings WHERE key = $1", key)
    return row["value_text"] if row is not None and row["value_text"] is not None else None


async def get_setting_int(key: str, default: int) -> int:
    value = await get_setting(key)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default
