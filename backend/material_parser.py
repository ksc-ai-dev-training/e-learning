# A-20 PUT /source が使う教材ソーステキストのパース/シリアライズ（詳細設計書7.2〜7.3節）。
# 本文中の見出し記号(#〜###)エスケープ（7.7節）に注意: markdown形式の本文が実際に
# #/##/### で始まる行を含む場合（例: 本文自体が見出し付きの記事）、章・小見出し・ページの
# 区切りと衝突しないようescape_body_for_source/_unescape_heading_lineで自動的に往復する。
from __future__ import annotations

import re
from dataclasses import dataclass, field

import yaml

HEADING_RE = re.compile(r"^(#{1,3})\s+(.*)$")
NODE_COMMENT_RE = re.compile(r"^<!--\s*node:(\d+)\s*-->$")
FORMAT_COMMENT_RE = re.compile(r"^<!--\s*format:(markdown|html)\s*-->$")
QUIZ_MODE_COMMENT_RE = re.compile(r"^<!--\s*quiz_mode:(all|pool)\s*-->$")
POOL_DRAW_COUNT_COMMENT_RE = re.compile(r"^<!--\s*pool_draw_count:(\d+)\s*-->$")
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
    format: str | None = None  # kind='page'のみ意味を持つ（markdown/html。ページごとに独立して選べる）
    quiz_mode: str = "all"  # kind='page'のみ意味を持つ（'all'/'pool'）
    pool_draw_count: int | None = None  # kind='page'かつquiz_mode='pool'のときのみ意味を持つ
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

            # 見出し行直後の注記（node/format/quiz_mode/pool_draw_count）を順不同で読み取る
            node_id = None
            page_format = fmt if kind == "page" else None
            quiz_mode = "all"
            pool_draw_count = None
            while i + 1 < len(lines):
                candidate = lines[i + 1].strip()
                nm = NODE_COMMENT_RE.match(candidate)
                if nm and node_id is None:
                    node_id = int(nm.group(1))
                    i += 1
                    continue
                if kind == "page":
                    fm = FORMAT_COMMENT_RE.match(candidate)
                    if fm:
                        page_format = fm.group(1)
                        i += 1
                        continue
                    qm = QUIZ_MODE_COMMENT_RE.match(candidate)
                    if qm:
                        quiz_mode = qm.group(1)
                        i += 1
                        continue
                    pd = POOL_DRAW_COUNT_COMMENT_RE.match(candidate)
                    if pd:
                        pool_draw_count = int(pd.group(1))
                        i += 1
                        continue
                break

            nodes.append(ParsedNode(
                kind=kind, title=title.strip(), sort_order=next_sort(parent_ref),
                parent_ref=parent_ref, node_id=node_id, format=page_format,
                quiz_mode=quiz_mode, pool_draw_count=pool_draw_count,
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
                page_format = nodes[current_page_idx].format or fmt
                body_buffer.append(_unescape_heading_line(line, page_format))
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


def _looks_like_heading(line: str, fmt: str) -> bool:
    """行が現在のドキュメント形式（markdown/html）の見出し記号と衝突するかどうか。
    エスケープ要否の判定と、エスケープ解除時の「本当に見出しだったか」の再チェックの両方で使う。"""
    if fmt == "html":
        return _html_heading_match(line) is not None
    return _markdown_heading_match(line) is not None


def _unescape_heading_line(line: str, fmt: str = "markdown") -> str:
    """本文中で見出し記号(markdown: #〜###／html: <h1>〜<h3>)と衝突しないよう書き出し側が
    エスケープした行を元に戻す（escape_body_for_sourceと対。CommonMark標準のバックスラッシュ
    エスケープと同じ考え方）。"""
    if line.startswith("\\") and _looks_like_heading(line[1:], fmt):
        return line[1:]
    return line


def escape_body_for_source(body: str, fmt: str = "markdown") -> str:
    """本文中に見出し記号（markdown: #〜###で始まる行／html: <h1>〜<h3>だけから成る行）があると、
    教材全体の章・小見出し・ページの区切りと誤認識されてしまう（ユーザーが説明文に普通の
    Markdown見出しを書いただけで「ページに説明文・問題のいずれも設定されていません」という
    混乱するエラーになっていた）。書き出し時に該当行をバックスラッシュでエスケープし、
    読み込み時に自動で元へ戻すことで、ユーザーには一切気にさせずに解消する（HTML形式の本文にも
    同じ保護を適用する）。DBに保存される本文自体は常に元のテキストのまま。"""
    return "\n".join(("\\" + line) if _looks_like_heading(line, fmt) else line for line in body.split("\n"))


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


QUESTION_FIELDS = (
    "id", "type", "prompt", "options", "correct_answer", "scoring_criteria",
    "code_language", "required", "is_critical", "feedback_style", "pool_group",
    "score_unit", "grading_mode",
)
# 既定値と一致する場合はテキストへ出力しない（往復時の差分を減らす）
QUESTION_FIELD_DEFAULTS = {"required": True, "is_critical": False}


def _serialize_question(q: dict) -> str:
    payload = {}
    for k in QUESTION_FIELDS:
        v = q.get(k)
        if v is None:
            continue
        if k in QUESTION_FIELD_DEFAULTS and v == QUESTION_FIELD_DEFAULTS[k]:
            continue
        payload[k] = v
    body = yaml.safe_dump(payload, allow_unicode=True, sort_keys=False).rstrip("\n")
    return f"{QUESTION_FENCE_START}\n{body}\n{QUESTION_FENCE_END}"


def serialize_source(material: dict, tree: list[dict]) -> str:
    """DBの状態（教材メタ＋ネスト済み目次ツリー）からソーステキストを組み立てる（A-20レスポンス用）。"""
    meta = {k: material[k] for k in META_FIELDS if k in material}
    front_matter = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).rstrip("\n")
    lines = ["---", front_matter, "---", ""]

    def append_page(page: dict):
        page_fmt = page.get("format") or meta.get("format", "markdown")
        lines.append(f"### {page['title']}")
        lines.append(f"<!-- node:{page['id']} -->")
        lines.append(f"<!-- format:{page_fmt} -->")
        if page.get("quiz_mode") == "pool":
            lines.append("<!-- quiz_mode:pool -->")
            if page.get("pool_draw_count") is not None:
                lines.append(f"<!-- pool_draw_count:{page['pool_draw_count']} -->")
        lines.append("")
        if page.get("body"):
            lines.append(escape_body_for_source(page["body"], page_fmt))
            lines.append("")
        for q in page.get("questions", []):
            lines.append(_serialize_question(q))
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
