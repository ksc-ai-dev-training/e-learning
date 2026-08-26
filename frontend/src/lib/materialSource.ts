import type { Material } from '../types'

// A-20 PUT /source が受け取るソーステキストの組み立て（バックエンドmaterial_parser.pyと対の実装）。
// 現状は章・小見出しのみを扱う（ページ・問題はS-17着手時に追加）。

export type EditableNode = {
  id: number | null // nullは未保存（新規）。保存済みノードはDBの実id
  title: string
  kind: 'chapter' | 'section'
  children: EditableNode[] // sectionのみ持つ。chapterは持たない
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
  for (const chapter of chapters) {
    lines.push(`# ${chapter.title}`)
    if (chapter.id !== null) lines.push(`<!-- node:${chapter.id} -->`)
    for (const section of chapter.children) {
      lines.push(`## ${section.title}`)
      if (section.id !== null) lines.push(`<!-- node:${section.id} -->`)
    }
  }
  return lines.join('\n') + '\n'
}
