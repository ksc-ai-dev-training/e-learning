# Markdown/HTML本文のレンダリング（基本設計書8.6節・詳細設計書07_教材連携詳細.html 7.5節）。
# A-64（プレビュー）専用。A-15の編集用レスポンスはこの関数を通さず原文のまま返す（7.5節末尾参照）。
import re

import markdown as _markdown

from html_sanitize import sanitize_html, strip_reserved_headings

_MD_EXTENSIONS = ["fenced_code", "tables"]

# 本文に画像を貼る記法: ![alt](attachment:123)（123はA-29で登録済みの添付ファイルID）。
# 添付ファイルは本番ではSupabase Storageに保存され、A-30と同じ署名付きURL（期限あり）でしか
# アクセスできないため、本文には恒久的なURLを直接書けない。その代わりattachment:IDという
# 教材内限定の参照だけを書いてもらい、表示のたびに（このAPI＝A-64が呼ばれるたびに）その時点で
# 有効なURLへ解決する。これによりBase64を手で埋め込む必要がなくなり、Claude Code等からも
# 「A-27/A-29でアップロードしてIDを本文に書く」という自然な手順になる（2026-09-07新設）。
_ATTACHMENT_SRC_RE = re.compile(r'src="attachment:(\d+)"')


async def _resolve_attachment_images(html: str, material_id: int, pool) -> str:
    ids = {int(m.group(1)) for m in _ATTACHMENT_SRC_RE.finditer(html)}
    if not ids:
        return html
    import storage

    rows = await pool.fetch(
        """SELECT id, storage_key FROM material_attachments
            WHERE material_id = $1 AND id = ANY($2::bigint[]) AND kind = 'file'""",
        material_id, list(ids),
    )
    urls: dict[int, str] = {}
    for row in rows:
        try:
            url, _expires_at = await storage.create_download_url(row["storage_key"])
            urls[row["id"]] = url
        except Exception:
            continue  # 解決できなければsrcを空にする（壊れた画像アイコン表示に留める）

    def repl(m: re.Match) -> str:
        attachment_id = int(m.group(1))
        return f'src="{urls[attachment_id]}"' if attachment_id in urls else 'src=""'

    return _ATTACHMENT_SRC_RE.sub(repl, html)


async def render_material_body(body: str, format: str, material_id: int, pool) -> str:
    """format='markdown'ならMarkdown→HTML変換後、'html'ならそのまま、
    attachment:ID参照の解決→h1/h2/h3除去→サニタイズを経てから返す。"""
    html = _markdown.markdown(body, extensions=_MD_EXTENSIONS) if format == "markdown" else body
    html = await _resolve_attachment_images(html, material_id, pool)
    html = strip_reserved_headings(html)
    return sanitize_html(html)
