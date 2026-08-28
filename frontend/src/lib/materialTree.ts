import type { MaterialNode } from '../types'
import type { EditableNode } from './materialSource'

// A-15のtoc（MaterialNode[]）とS-05/S-17がローカルstateで編集するEditableNode[]の相互変換、
// および特定ノードの検索・差し替え・追加を行うヘルパー。S-05（章・小見出し編集）・
// S-17（1ページの編集）の両方から使う（他ページの内容を素通りさせるため、両画面とも
// A-15で取得した全ツリーをEditableNodeへ変換してから保存する）。

export function convertPage(p: MaterialNode): EditableNode {
  return {
    id: p.id,
    title: p.title,
    kind: 'page',
    children: [],
    body: p.body,
    format: p.format ?? 'markdown',
    quizMode: p.quiz_mode,
    poolDrawCount: p.pool_draw_count,
    questions: p.questions,
  }
}

function convertChapterChild(child: MaterialNode): EditableNode {
  if (child.kind === 'section') {
    return {
      id: child.id,
      title: child.title,
      kind: 'section' as const,
      children: child.children.map(convertPage),
    }
  }
  return convertPage(child)
}

export function toEditableChapters(toc: MaterialNode[]): EditableNode[] {
  return toc
    .filter((n) => n.kind === 'chapter')
    .map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      kind: 'chapter' as const,
      children: chapter.children.map(convertChapterChild),
    }))
}

// ページ行に表示する内容種別ラベル（画面モックアップの「説明」「問題×3」「説明＋問題×2」に対応）
export function pageKindLabel(page: EditableNode): string {
  const hasBody = !!page.body
  const count = page.questions?.length ?? 0
  if (hasBody && count > 0) return `説明＋問題×${count}`
  if (count > 0) return `問題×${count}`
  return '説明'
}

export function findNode(nodes: EditableNode[], id: number): EditableNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children.length > 0) {
      const found = findNode(n.children, id)
      if (found) return found
    }
  }
  return null
}

// targetIdを持つページノードを丸ごと差し替える（S-17の既存ページ保存用）
export function replacePageInTree(nodes: EditableNode[], targetId: number, page: EditableNode): EditableNode[] {
  return nodes.map((n) => {
    if (n.id === targetId && n.kind === 'page') return page
    if (n.children.length > 0) return { ...n, children: replacePageInTree(n.children, targetId, page) }
    return n
  })
}

// parentIdを持つノード（章 or 小見出し）の子としてページを追加する（S-17の新規ページ保存用）
export function insertPageInTree(nodes: EditableNode[], parentId: number, page: EditableNode): EditableNode[] {
  return nodes.map((n) => {
    if (n.id === parentId) return { ...n, children: [...n.children, page] }
    if (n.children.length > 0) return { ...n, children: insertPageInTree(n.children, parentId, page) }
    return n
  })
}
