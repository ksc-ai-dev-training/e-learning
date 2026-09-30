import { apiFetch } from './api'
import type { Material, MaterialNode, QuizAttempt } from '../types'

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

// 誤答＆難問抽出（wrong_only）で複数教材のキューを解く際、次に開くべきページのIDを求める。
// attempt.question_orderのキー（ページID）はJavaScriptの仕様上Object.keys()が数値文字列を
// 昇順に並べ替えてしまうため、単純にkeys[0]を使うと「目次上の並び順」ではなく「一番小さいページID」
// になってしまう（ページIDは作成順であり、編集者が後から並び替えていると目次順とズレる。
// 2026-10-01、ユーザー報告により発見）。自分が今見ている教材ならownFlatPages（目次順）から
// 探せば正しく求まるが、キューの次の教材は目次情報を持っていないため、その場合のみ教材を
// 取得してから同じ方法で探す。取得に失敗した場合は差分が出ないよう、従来のkeys[0]にフォールバックする。
export async function resolveFirstQueueNodeId(
  attempt: QuizAttempt,
  ownMaterialId: number,
  ownFlatPages: FlatPage[],
): Promise<number> {
  const keys = Object.keys(attempt.question_order).map(Number)
  if (attempt.material_id === ownMaterialId) {
    const matching = ownFlatPages.find((p) => keys.includes(p.node.id))
    return matching ? matching.node.id : keys[0]
  }
  try {
    const material = await apiFetch<Material>(`/api/materials/${attempt.material_id}`)
    const matching = flattenPages(material.toc ?? []).find((p) => keys.includes(p.node.id))
    if (matching) return matching.node.id
  } catch {
    // 取得に失敗した場合は下のkeys[0]へフォールバックする
  }
  return keys[0]
}
