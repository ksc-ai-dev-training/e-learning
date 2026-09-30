# HTMLサニタイズ（基本設計書8.6節・詳細設計書07_教材連携詳細.html 7.5節）。
# 許可リスト方式。h1/h2/h3は章・小見出し・ページの境界として予約済みのため許可しない。
import re

import nh3

ALLOWED_TAGS = {
    "p", "br", "strong", "em", "u", "s", "code", "pre", "blockquote",
    "ul", "ol", "li", "h4", "h5", "h6", "table", "thead", "tbody",
    "tr", "th", "td", "a", "img", "figure", "figcaption",
}
ALLOWED_ATTRIBUTES = {
    # "rel"はlink_rel指定時にnh3が自動管理するため、ここに含めるとValueErrorになる
    "a": {"href", "target"},
    "img": {"src", "alt", "width", "height"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
}
ALLOWED_URL_SCHEMES = {"http", "https", "data"}

_RESERVED_HEADING_RE = re.compile(r"</?h[123]\b[^>]*>", re.IGNORECASE)


def strip_reserved_headings(html: str) -> str:
    """h1/h2/h3は章・小見出し・ページの境界として予約済みのため、本文レンダリング後に
    生タグが残っていても防御的に除去する（通常はmaterial_nodes.bodyに見出しは含まれない想定）。"""
    return _RESERVED_HEADING_RE.sub("", html)


def _restrict_data_scheme_to_img_src(tag: str, attr: str, value: str) -> str | None:
    """data:スキームは教材本文に画像を直接埋め込む用途（永続的なURLを発行できない環境向け）
    のみ許可し、img[src]以外（特にa[href]、data:text/htmlによるフィッシング等）では
    許可しない（2026-09-07）。"""
    if value.startswith("data:") and not (tag == "img" and attr == "src"):
        return None
    return value


def sanitize_html(raw_html: str) -> str:
    return nh3.clean(
        raw_html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        url_schemes=ALLOWED_URL_SCHEMES,
        attribute_filter=_restrict_data_scheme_to_img_src,
        link_rel="noopener noreferrer",
    )
