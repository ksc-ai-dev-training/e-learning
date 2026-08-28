import type { Material, Question, QuizMode } from '../types'

// A-20 PUT /source が受け取るソーステキストの組み立て（バックエンドmaterial_parser.pyと対の実装）。

export type EditableNode = {
  id: number | null // nullは未保存（新規）。保存済みノードはDBの実id
  title: string
  kind: 'chapter' | 'section' | 'page'
  children: EditableNode[] // sectionのみ持つ。chapterは持たない。pageは常に[]
  // 以下はkind='page'のみ意味を持つ（chapter/sectionでは無視される）
  body?: string | null
  format?: 'markdown' | 'html'
  quizMode?: QuizMode
  poolDrawCount?: number | null
  questions?: Question[]
}

type SourceMeta = Pick<
  Material,
  | 'id'
  | 'project_id'
  | 'title'
  | 'description'
  | 'tags'
  | 'status'
  | 'sort_order'
  | 'attempt_scope'
  | 'retake_scope'
  | 'default_feedback_style'
  | 'ai_context'
  | 'grading_mode'
>

function yamlScalar(v: string): string {
  // コロン・#・引用符等YAMLで特別な意味を持つ文字を含む場合はJSON文字列としてクォートする
  // （YAMLはJSON互換のフロースカラーを受理するため、安全にダブルクォート表現できる）
  if (v !== '' && /^[\p{L}\p{N}_./-]*$/u.test(v)) {
    return v
  }
  return JSON.stringify(v)
}

function yamlNullableScalar(v: string | null): string {
  return v === null ? 'null' : yamlScalar(v)
}

function yamlList(items: string[]): string {
  if (items.length === 0) return ' []'
  return '\n' + items.map((i) => `  - ${yamlScalar(i)}`).join('\n')
}

const HEADING_LIKE_RE = /^#{1,3}\s.*$/
const HTML_HEADING_LIKE_RE = /^<h([123])>.*<\/h\1>$/

// 本文中に見出し記号（markdown: #〜###で始まる行／html: <h1>〜<h3>だけから成る行）があると、
// 教材全体の章・小見出し・ページの区切りと衝突してしまうため、往復用テキストへ書き出す際に
// バックスラッシュでエスケープする（CommonMark標準のエスケープと同じ考え方。
// backend/material_parser.pyのescape_body_for_source/_unescape_heading_lineと対。
// ページごとのformat（markdown/html）に応じて対象の見出しパターンを切り替える）。
// ユーザーが画面で見る本文自体は変えない。
function escapeBodyForSource(body: string, format: 'markdown' | 'html' = 'markdown'): string {
  const pattern = format === 'html' ? HTML_HEADING_LIKE_RE : HEADING_LIKE_RE
  return body
    .split('\n')
    .map((line) => (pattern.test(line) ? '\\' + line : line))
    .join('\n')
}

function serializeQuestion(q: Question): string {
  const lines: string[] = []
  if (q.id !== null) lines.push(`id: ${q.id}`)
  lines.push(`type: ${q.type}`)
  lines.push(`prompt: ${yamlScalar(q.prompt)}`)
  if (q.options && q.options.length > 0) {
    lines.push(`options:${yamlList(q.options)}`)
  }
  if (q.correct_answer !== null) {
    if (Array.isArray(q.correct_answer)) {
      lines.push(`correct_answer:${yamlList(q.correct_answer)}`)
    } else {
      lines.push(`correct_answer: ${yamlScalar(q.correct_answer)}`)
    }
  }
  if (q.scoring_criteria) lines.push(`scoring_criteria: ${yamlScalar(q.scoring_criteria)}`)
  if (q.code_language) lines.push(`code_language: ${yamlScalar(q.code_language)}`)
  if (!q.required) lines.push('required: false')
  if (q.is_critical) lines.push('is_critical: true')
  if (q.feedback_style) lines.push(`feedback_style: ${q.feedback_style}`)
  if (q.score_unit) lines.push(`score_unit: ${yamlScalar(q.score_unit)}`)
  if (q.grading_mode) lines.push(`grading_mode: ${q.grading_mode}`)
  if (q.pool_group !== null) lines.push(`pool_group: ${q.pool_group}`)
  return ['```question', ...lines, '```'].join('\n')
}

export function buildMaterialSource(meta: SourceMeta, chapters: EditableNode[]): string {
  const frontMatter = [
    `id: ${meta.id}`,
    `project_id: ${meta.project_id}`,
    `title: ${yamlScalar(meta.title)}`,
    `description: ${yamlNullableScalar(meta.description)}`,
    `tags:${yamlList(meta.tags)}`,
    `format: markdown`,
    `status: ${meta.status}`,
    `sort_order: ${meta.sort_order}`,
    `attempt_scope: ${meta.attempt_scope}`,
    `retake_scope: ${meta.retake_scope}`,
    `default_feedback_style: ${meta.default_feedback_style}`,
    `ai_context: ${yamlNullableScalar(meta.ai_context)}`,
    `grading_mode: ${meta.grading_mode}`,
  ].join('\n')

  const lines: string[] = ['---', frontMatter, '---', '']

  function appendPage(page: EditableNode) {
    const pageFormat = page.format ?? 'markdown'
    lines.push(`### ${page.title}`)
    if (page.id !== null) lines.push(`<!-- node:${page.id} -->`)
    lines.push(`<!-- format:${pageFormat} -->`)
    if (page.quizMode === 'pool') {
      lines.push('<!-- quiz_mode:pool -->')
      if (page.poolDrawCount !== null && page.poolDrawCount !== undefined) {
        lines.push(`<!-- pool_draw_count:${page.poolDrawCount} -->`)
      }
    }
    lines.push('')
    if (page.body) {
      lines.push(escapeBodyForSource(page.body, pageFormat))
      lines.push('')
    }
    for (const q of page.questions ?? []) {
      lines.push(serializeQuestion(q))
      lines.push('')
    }
  }

  for (const chapter of chapters) {
    lines.push(`# ${chapter.title}`)
    if (chapter.id !== null) lines.push(`<!-- node:${chapter.id} -->`)
    for (const child of chapter.children) {
      if (child.kind === 'section') {
        lines.push(`## ${child.title}`)
        if (child.id !== null) lines.push(`<!-- node:${child.id} -->`)
        for (const page of child.children) {
          appendPage(page)
        }
      } else {
        appendPage(child)
      }
    }
  }
  return lines.join('\n') + '\n'
}
