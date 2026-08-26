# A-20 PUT /source が使う教材ソーステキストのパース/シリアライズ（詳細設計書7.2〜7.3節）。
# 現時点ではページ（###見出し）・問題ブロックはUIから作られないため、
# その部分は仕様通りの形は保ちつつ最小限の実装にとどめる（S-17着手時に厳密化する）。
from __future__ import annotations

import re
from dataclasses import dataclass, field

import yaml

HEADING_RE = re.compile(r"^(#{1,3})\s+(.*)$")
NODE_COMMENT_RE = re.compile(r"^<!--\s*node:(\d+)\s*-->$")
QUESTION_FENCE_START = "```question"
QUESTION_FENCE_END = "```"

META_FIELDS = (
    "id", "project_id", "title", "description", "tags", "format", "status",
    "sort_order", "attempt_scope", "retake_scope", "default_feedback_style",
    "ai_context", "grading_mode",
)


class MaterialParseError(Exception):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


@dataclass
class ParsedNode:
    kind: str  # 'chapter' | 'section' | 'page'
    title: str
    sort_order: int
    parent_ref: int | None  # 同一リクエスト内での親ノードのインデックス（章はNone）
    node_id: int | None = None
    body: str | None = None
    content_kind: str | None = None
    questions: list[dict] = field(default_factory=list)


def parse_source(text: str) -> tuple[dict, list[ParsedNode]]:
    """フロントマター＋見出し階層のテキストを (meta, nodes) にパースする。"""
    if not text.startswith("---"):
        raise MaterialParseError("先頭にフロントマター（---で囲んだメタデータ）がありません")
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise MaterialParseError("フロントマターの終端（---）が見つかりません")
    try:
        meta = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError as e:
        raise MaterialParseError(f"フロントマターのYAML解析に失敗しました: {e}")

    fmt = meta.get("format", "markdown")
    lines = parts[2].splitlines()

    nodes: list[ParsedNode] = []
    chapter_idx: int | None = None
    section_idx: int | None = None
    current_page_idx: int | None = None
    body_buffer: list[str] = []
    sort_counters: dict[int | None, int] = {}

    def next_sort(parent_ref: int | None) -> int:
        n = sort_counters.get(parent_ref, 0)
        sort_counters[parent_ref] = n + 1
        return n

    def flush_page_body():
        nonlocal body_buffer
        if current_page_idx is not None:
            page = nodes[current_page_idx]
            body, questions = _extract_questions("\n".join(body_buffer).strip("\n"))
            page.body = body or None
            page.questions = questions
            if page.body and questions:
                page.content_kind = "mixed"
            elif questions:
                page.content_kind = "quiz"
            elif page.body:
                page.content_kind = "explanation"
            else:
                raise MaterialParseError(f"ページ「{page.title}」に説明文・問題のいずれも設定されていません")
        body_buffer = []

    i = 0
    while i < len(lines):
        line = lines[i]
        m = _markdown_heading_match(line) if fmt == "markdown" else _html_heading_match(line)
        if m:
            flush_page_body()
            level, title = m
            node_id = None
            if i + 1 < len(lines):
                nm = NODE_COMMENT_RE.match(lines[i + 1].strip())
                if nm:
                    node_id = int(nm.group(1))
                    i += 1

            if level == 1:
                parent_ref = None
                kind = "chapter"
            elif level == 2:
                if chapter_idx is None:
                    raise MaterialParseError("本文の先頭は章（#見出し）から始めてください")
                parent_ref = chapter_idx
                kind = "section"
            else:
                if chapter_idx is None:
                    raise MaterialParseError("本文の先頭は章（#見出し）から始めてください")
                parent_ref = section_idx if section_idx is not None else chapter_idx
                kind = "page"

            nodes.append(ParsedNode(
                kind=kind, title=title.strip(), sort_order=next_sort(parent_ref),
                parent_ref=parent_ref, node_id=node_id,
            ))
            idx = len(nodes) - 1
            if level == 1:
                chapter_idx = idx
                section_idx = None
                current_page_idx = None
            elif level == 2:
                section_idx = idx
                current_page_idx = None
            else:
                current_page_idx = idx
        else:
            if current_page_idx is not None:
                body_buffer.append(line)
            elif line.strip():
                raise MaterialParseError("見出し行以外の本文はページ（###見出し）の直後にのみ記述できます")
        i += 1
    flush_page_body()

    return meta, nodes


def _markdown_heading_match(line: str) -> tuple[int, str] | None:
    m = HEADING_RE.match(line)
    if not m:
        return None
    return len(m.group(1)), m.group(2)


def _html_heading_match(line: str) -> tuple[int, str] | None:
    m = re.match(r"^<h([123])>(.*)</h\1>$", line.strip())
    if not m:
        return None
    return int(m.group(1)), m.group(2)


def _extract_questions(body: str) -> tuple[str, list[dict]]:
    """```question フェンスブロックを本文から取り除き、問題定義（YAML）として抽出する。"""
    if QUESTION_FENCE_START not in body:
        return body, []
    lines = body.splitlines()
    text_lines: list[str] = []
    questions: list[dict] = []
    in_fence = False
    fence_buffer: list[str] = []
    for line in lines:
        if not in_fence and line.strip() == QUESTION_FENCE_START:
            in_fence = True
            fence_buffer = []
            continue
        if in_fence and line.strip() == QUESTION_FENCE_END:
            in_fence = False
            try:
                q = yaml.safe_load("\n".join(fence_buffer)) or {}
            except yaml.YAMLError as e:
                raise MaterialParseError(f"問題ブロックのYAML解析に失敗しました: {e}")
            questions.append(q)
            continue
        if in_fence:
            fence_buffer.append(line)
        else:
            text_lines.append(line)
    return "\n".join(text_lines).strip("\n"), questions


def serialize_source(material: dict, tree: list[dict]) -> str:
    """DBの状態（教材メタ＋ネスト済み目次ツリー）からソーステキストを組み立てる（A-20レスポンス用）。"""
    meta = {k: material[k] for k in META_FIELDS if k in material}
    front_matter = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).rstrip("\n")
    lines = ["---", front_matter, "---", ""]

    def append_page(page: dict):
        lines.append(f"### {page['title']}")
        lines.append(f"<!-- node:{page['id']} -->")
        if page.get("body"):
            lines.append(page["body"])
        lines.append("")

    for chapter in tree:
        lines.append(f"# {chapter['title']}")
        lines.append(f"<!-- node:{chapter['id']} -->")
        for child in chapter.get("children", []):
            if child["kind"] == "section":
                lines.append(f"## {child['title']}")
                lines.append(f"<!-- node:{child['id']} -->")
                for page in child.get("children", []):
                    append_page(page)
            else:
                append_page(child)
    return "\n".join(lines).rstrip("\n") + "\n"
