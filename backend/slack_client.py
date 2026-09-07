# Slack Incoming Webhookへのメッセージ送信（F-12 Slack受講催促通知）。
# 個人ごとのOAuth連携（本人へのDM）は、社内Slackワークスペースのカスタムアプリ数上限により
# 新規アプリを作成できず利用できなかったため、既存のIncoming Webhookを使う方式に置き換えた
# （検討資料/20260903_Slack連携方式比較.html参照。2026-09-04）。プロジェクト単位で1本のWebhook
# URLを使い、そのプロジェクトの必修教材の未受講状況（教材単位の集計、個人名は含めない）を
# チャンネルへ通知する。個人ごとの催促は運用（担当者が直接連絡）でカバーする。
from __future__ import annotations

import httpx


async def send_webhook_message(webhook_url: str, text: str) -> None:
    """保存済みのIncoming Webhook URLへメッセージを投稿する。失敗時（URLが無効化された等）は
    RuntimeErrorを送出する（呼び出し側でHTTPExceptionへ変換する）。"""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(webhook_url, json={"text": text})
    res.raise_for_status()
    if res.text != "ok":
        raise RuntimeError(f"Slack incoming webhook failed: {res.text!r}")
