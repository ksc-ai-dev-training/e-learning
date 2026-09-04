#!/usr/bin/env python3
"""Manabi CLIログイン（A-62）。
ブラウザでGoogle OAuthを行い、取得したCLIトークンを ~/.config/Manabi/credentials に保存する。
使い方: python cli/manabi_login.py
環境変数 MANABI_URL でバックエンドのURLを指定できる（既定: http://localhost:5177）。
"""
import http.server
import json
import os
import socket
import stat
import sys
import urllib.parse
import webbrowser

MANABI_URL = os.environ.get("MANABI_URL", "http://localhost:5177")
CREDENTIALS_PATH = os.path.expanduser("~/.config/Manabi/credentials")


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    token: str | None = None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        token = params.get("token", [None])[0]
        _CallbackHandler.token = token
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        message = "ログインしました。このタブは閉じて構いません。" if token else "ログインに失敗しました。"
        self.wfile.write(f"<html><body>{message}</body></html>".encode("utf-8"))

    def log_message(self, format, *args):
        pass  # アクセスログを標準エラーに出さない


def main() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    server = http.server.HTTPServer(("127.0.0.1", port), _CallbackHandler)
    login_url = f"{MANABI_URL}/api/auth/cli/login?callback_port={port}"
    print(f"ブラウザでログインしてください: {login_url}")
    webbrowser.open(login_url)
    server.handle_request()
    server.server_close()

    token = _CallbackHandler.token
    if not token:
        print("ログインに失敗しました。", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(CREDENTIALS_PATH), exist_ok=True)
    with open(CREDENTIALS_PATH, "w", encoding="utf-8") as f:
        json.dump({"manabi_url": MANABI_URL, "token": token}, f)
    try:
        os.chmod(CREDENTIALS_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass  # Windowsではchmodの効果は限定的だが、失敗しても致命的ではない

    print(f"ログインしました。トークンを {CREDENTIALS_PATH} に保存しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
