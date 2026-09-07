# Slack個人連携によるDM送信（F-12 Slack受講催促通知）。
# 以前はワークスペース共通のIncoming Webhook（固定チャンネル向け）だったが、REQ-F-08「対象者本人へ
# 個別に」促す要求に対しては個人を特定して送れないため、本人ごとのOAuth連携（slack_oauth.py）に
# 置き換えた（ユーザー判断、2026-09-03）。Bot User・Bot Token Scopeは使わず、本人のUser Access
# Tokenで本人宛てに投稿する（conversations.openで自分とのDMチャンネルを開き、そこに投稿する）。
from __future__ import annotations

import httpx


async def send_reminder_dm(access_token: str, slack_user_id: str, text: str) -> None:
    """保存済みのUser Access Tokenで、本人（slack_user_id）宛てにDMを送る。
    失敗時（連携が取り消された等）はRuntimeErrorを送出する（呼び出し側でHTTPExceptionへ変換する）。"""
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=10) as client:
        open_res = await client.post(
            "https://slack.com/api/conversations.open", headers=headers, data={"users": slack_user_id}
        )
        open_res.raise_for_status()
        open_data = open_res.json()
        if not open_data.get("ok"):
            raise RuntimeError(f"Slack conversations.open failed: {open_data.get('error')}")
        channel_id = open_data["channel"]["id"]

        msg_res = await client.post(
            "https://slack.com/api/chat.postMessage",
            headers=headers,
            data={"channel": channel_id, "text": text},
        )
        msg_res.raise_for_status()
        msg_data = msg_res.json()
        if not msg_data.get("ok"):
            raise RuntimeError(f"Slack chat.postMessage failed: {msg_data.get('error')}")
