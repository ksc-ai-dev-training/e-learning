# Slack Incoming Webhook連携（F-11 未受講者への催促・A-57 テスト送信）。
# 通知先チャンネル自体はWebhook登録時に固定されるため、slack_channel設定はUI表示用の
# ラベルに過ぎない（実際の送信先を切り替えるものではない。03_テーブル定義.html T-21参照）。
from __future__ import annotations

import httpx


async def send_message(webhook_url: str, text: str) -> None:
    """Incoming WebhookへJSONペイロードを送信する。失敗時はhttpxの例外がそのまま伝播する
    （呼び出し側でHTTPExceptionへ変換する）。"""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(webhook_url, json={"text": text})
        resp.raise_for_status()


async def send_test_message(webhook_url: str) -> None:
    """A-57: システム設定画面からのテスト送信。"""
    await send_message(
        webhook_url,
        "Manabiからのテスト通知です。この通知が届いていれば、Slack連携は正常に設定されています。",
    )
