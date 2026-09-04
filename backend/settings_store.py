# T-21 app_settings（システム設定）の読み取り専用ヘルパー。auth_helpers.py（プロジェクト離任後の
# 猶予期間判定、5.5節）とai_client.py（AIモデル選択）・routers/settings.py（A-55〜A-57・A-80）の
# 全員がこれを経由する。routers/settings.pyからauth_helpers.pyを参照すると循環importになるため、
# どこからも参照されない独立モジュールとして切り出した。
from __future__ import annotations

import os

from database import get_pool

SETTING_KEYS = ("ai_model", "slack_webhook_url", "slack_channel", "project_leave_grace_period_days")
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


async def get_ai_model() -> str:
    """03_テーブル定義.html T-21キー一覧: T-21 > 環境変数ANTHROPIC_MODEL > 既定値。"""
    return await get_setting("ai_model") or os.environ.get("ANTHROPIC_MODEL", "").strip() or ""


async def get_slack_webhook_url() -> str | None:
    """T-21 > 環境変数SLACK_WEBHOOK_URL。"""
    return await get_setting("slack_webhook_url") or os.environ.get("SLACK_WEBHOOK_URL") or None
