# Markdown/HTML本文のレンダリング（基本設計書8.6節・詳細設計書07_教材連携詳細.html 7.5節）。
# A-64（プレビュー）専用。A-15の編集用レスポンスはこの関数を通さず原文のまま返す（7.5節末尾参照）。
import markdown as _markdown

from html_sanitize import sanitize_html, strip_reserved_headings

_MD_EXTENSIONS = ["fenced_code", "tables"]


def render_material_body(body: str, format: str) -> str:
    """format='markdown'ならMarkdown→HTML変換後、'html'ならそのまま、
    h1/h2/h3除去＋サニタイズを経てから返す。"""
    html = _markdown.markdown(body, extensions=_MD_EXTENSIONS) if format == "markdown" else body
    html = strip_reserved_headings(html)
    return sanitize_html(html)
