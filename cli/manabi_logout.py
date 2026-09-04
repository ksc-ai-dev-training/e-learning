#!/usr/bin/env python3
"""Manabi CLIログアウト（A-63）。
保存済みCLIトークンをサーバー側で失効させ、ローカルの認証情報ファイルを削除する。
使い方: python cli/manabi_logout.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

CREDENTIALS_PATH = os.path.expanduser("~/.config/Manabi/credentials")


def main() -> int:
    if not os.path.exists(CREDENTIALS_PATH):
        print("ログインしていません。")
        return 0

    with open(CREDENTIALS_PATH, encoding="utf-8") as f:
        creds = json.load(f)

    req = urllib.request.Request(
        f"{creds['manabi_url']}/api/auth/cli/revoke",
        method="POST",
        headers={"Authorization": f"Bearer {creds['token']}"},
    )
    try:
        with urllib.request.urlopen(req) as res:
            print(json.loads(res.read())["detail"])
    except urllib.error.HTTPError as e:
        print(f"失効リクエストに失敗しました（{e.code}）。ローカルの認証情報のみ削除します。", file=sys.stderr)

    os.remove(CREDENTIALS_PATH)
    print(f"{CREDENTIALS_PATH} を削除しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
