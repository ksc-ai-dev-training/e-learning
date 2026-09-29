import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import TocPageRow from './TocPageRow'
import { pageKindLabel } from '../../lib/materialTree'
import type { EditableNode } from '../../lib/materialSource'

const COLLAPSED_KEY = 'manabi-material-toc-collapsed'

// S-16 教材受講ページ用の目次パネル。目次画面（MaterialView.tsx）と同じ章・小見出し・ページの
// 一覧をそのまま表示し、クリックでそのページへ直接遷移できるようにする（2026-09-29、「ページを
// またいで移動したい」という要望への対応）。目次画面に元々ページの到達可否によるロックが無く、
// どのページも常にクリック可能なリンクだったため、このパネルは既存の遷移方法（目次画面経由）を
// ページ受講中でも使えるようにするショートカットに過ぎず、新しい抜け道を作るものではない。
// レイアウト上の兄弟要素にはせずfixed配置のオーバーレイにすることで、開閉しても本文
// （min-w-0 flex-1側）の幅は一切変化しないようにする（2026-09-29、ユーザー要望：開閉のたびに
// 本文が詰め直されるのが気になるとの指摘）。開閉は「目次」ラベル＋シェブロンの見出しバーを
// 常に表示したまま、その下のページ一覧だけを上下に開閉するアコーディオン形式にする
// （同ユーザー要望：閉じた状態でも何を開くボタンなのか一目で分かるようにしたいとの指摘。
// 折りたたみ時は丸ボタンだけが残る形だと再度開いたときに何が出るか分かりにくかったため）。
export default function MaterialTocSidebar({
  materialId,
  chapters,
  viewingNodeId,
  completedIds,
  visitedIds,
  query,
}: {
  materialId: number
  chapters: EditableNode[]
  viewingNodeId: number
  completedIds: Set<number>
  visitedIds: Set<number>
  query: string
}) {
  // 開閉状態はSidebar.tsxと同じくlocalStorageに保存し、他画面・再読み込みをまたいでも覚えておく
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      } catch {
        // プライベートブラウジング等でlocalStorageが使えない場合は単に記憶されないだけでよい
      }
      return !c
    })

  if (chapters.length === 0) return null

  return (
    <div className="fixed right-4 top-20 z-20 hidden w-64 lg:block">
      <div className="rounded-md border border-slate-200 bg-white shadow-md dark:border-neutral-800 dark:bg-neutral-900">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          目次
          {collapsed ? <ChevronDown className="h-4 w-4 text-slate-400 dark:text-neutral-500" /> : <ChevronUp className="h-4 w-4 text-slate-400 dark:text-neutral-500" />}
        </button>
        {!collapsed && (
          <nav className="max-h-[70vh] overflow-y-auto border-t border-slate-200 p-1.5 dark:border-neutral-800">
            {chapters.map((chapter, chapterIndex) => (
              <div key={chapter.id} className="mb-2">
                <div className="px-2 py-1 text-[11px] font-semibold text-slate-500 dark:text-neutral-400">
                  第{chapterIndex + 1}章 {chapter.title}
                </div>
                {chapter.children.map((child) =>
                  child.kind === 'section' ? (
                    <div key={child.id} className="ml-1">
                      <div className="px-2 py-0.5 text-[10.5px] font-semibold text-slate-400 dark:text-neutral-500">
                        {child.title}
                      </div>
                      {child.children.map((page) => (
                        <TocPageRow
                          key={page.id}
                          materialId={materialId}
                          nodeId={page.id}
                          title={page.title}
                          kindLabel={pageKindLabel(page)}
                          done={page.id !== null && (completedIds.has(page.id) || visitedIds.has(page.id))}
                          isViewing={page.id === viewingNodeId}
                          query={query}
                        />
                      ))}
                    </div>
                  ) : (
                    <TocPageRow
                      key={child.id}
                      materialId={materialId}
                      nodeId={child.id}
                      title={child.title}
                      kindLabel={pageKindLabel(child)}
                      done={child.id !== null && (completedIds.has(child.id) || visitedIds.has(child.id))}
                      isViewing={child.id === viewingNodeId}
                      query={query}
                    />
                  ),
                )}
              </div>
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}
