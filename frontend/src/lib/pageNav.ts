import type { MaterialNode } from '../types'

export interface FlatPage {
  node: MaterialNode
  chapterId: number
  chapterTitle: string
  sectionId: number | null
  sectionTitle: string | null
}

// tocを深さ優先で辿り、ページ（kind='page'）だけを文書順にフラット化する
// （backendの_collect_pagesと同じ並び順: parent_node_id NULLS FIRST, sort_order）
export function flattenPages(toc: MaterialNode[]): FlatPage[] {
  const pages: FlatPage[] = []
  for (const chapter of toc) {
    if (chapter.kind !== 'chapter') continue
    for (const child of chapter.children) {
      if (child.kind === 'page') {
        pages.push({ node: child, chapterId: chapter.id, chapterTitle: chapter.title, sectionId: null, sectionTitle: null })
      } else if (child.kind === 'section') {
        for (const page of child.children) {
          if (page.kind === 'page') {
            pages.push({
              node: page,
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              sectionId: child.id,
              sectionTitle: child.title,
            })
          }
        }
      }
    }
  }
  return pages
}

export function findPageIndex(pages: FlatPage[], nodeId: number): number {
  return pages.findIndex((p) => p.node.id === nodeId)
}

// attempt_scope・対象ページIDから、A-40へ渡すべきscope_node_idを求める。
// 'material'ならnull、'page'ならページ自身のID、'chapter'/'section'は対応する祖先ノードのID。
// 'section'指定でも小見出しが無い（章直下のページ）場合は章IDにフォールバックする。
export function resolveScopeNodeId(
  pages: FlatPage[],
  attemptScope: 'material' | 'chapter' | 'section' | 'page',
  nodeId: number,
): number | null {
  if (attemptScope === 'material') return null
  if (attemptScope === 'page') return nodeId
  const page = pages.find((p) => p.node.id === nodeId)
  if (!page) return null
  if (attemptScope === 'section') return page.sectionId ?? page.chapterId
  return page.chapterId
}
