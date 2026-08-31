import { useState } from 'react'
import { Link, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import { useMaterial } from '../hooks/useMaterial'
import { useMaterialAttachments } from '../hooks/useMaterialAttachments'
import { formatDateJst } from '../lib/datetime'
import { openAttachmentDownload } from '../lib/attachmentActions'
import { pageKindLabel, toEditableChapters } from '../lib/materialTree'
import { ApiError } from '../lib/api'
import type { EditableNode } from '../lib/materialSource'

const TABS = [
  { key: 'toc', label: '目次' },
  { key: 'practice', label: '反復演習' },
  { key: 'wrong_only', label: '誤答のみ抽出' },
] as const
type TabKey = (typeof TABS)[number]['key']

// S-04 教材受講：目次（詳細設計書10.4節）の縮小版。今回のスコープは目次タブのみ
// （ヘッダー・進捗バー・教材全体の資料・目次ツリー）。前回の受験結果パネル・反復演習／
// 誤答のみ抽出タブはA-40〜A-44・S-16（受講ページ）実装後に追加する。
export default function MaterialView() {
  const { materialId } = useParams<{ materialId: string }>()
  const id = Number(materialId)
  const { material, error, isLoading } = useMaterial(id)
  const { attachments } = useMaterialAttachments(id)
  const [activeTab, setActiveTab] = useState<TabKey>('toc')
  const [downloadError, setDownloadError] = useState<string | null>(null)

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (error || !material) {
    const message =
      error instanceof ApiError && error.status === 403
        ? 'この教材は受講対象ではありません。'
        : '教材を取得できませんでした。'
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="教材受講" />
        <div className="px-8 py-6">
          <Link to="/materials" className="text-blue-800 hover:underline">
            ← 教材一覧に戻る
          </Link>
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
        </div>
      </div>
    )
  }

  const chapters = toEditableChapters(material.toc ?? [])
  const totalPages = material.page_count ?? 0
  const completedIds = new Set(material.progress?.completed_node_ids ?? [])
  const completedCount = chapters.reduce((sum, chapter) => sum + countCompletedPages(chapter.children, completedIds), 0)
  const progressPct = totalPages > 0 ? Math.round((completedCount / totalPages) * 100) : 0
  const wholeMaterialAttachments = attachments.filter((a) => a.node_id === null)

  const download = async (attachmentId: number) => {
    setDownloadError(null)
    try {
      await openAttachmentDownload(id, attachmentId)
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : 'ダウンロードに失敗しました')
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={material.title}
        actions={
          <Link
            to="/materials"
            className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            ← 教材一覧に戻る
          </Link>
        }
      />
      <div className="px-8 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
          <Badge variant={material.required ? 'required' : 'optional'} />
          <span>
            全{chapters.length}章・{totalPages}ページ
          </span>
          {material.due_at && <span>／ 期限: {formatDateJst(material.due_at)}</span>}
        </div>

        <div className="mb-5 flex gap-1 border-b border-slate-200" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                activeTab === tab.key
                  ? 'border-blue-800 text-blue-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'toc' && (
          <>
            {totalPages > 0 && (
              <div className="mb-5 flex items-center gap-3">
                <span className="text-xs text-slate-500">
                  ページ {completedCount}/{totalPages}
                </span>
                <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-blue-700" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="text-xs text-slate-500">{progressPct}%</span>
              </div>
            )}

            {downloadError && (
              <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {downloadError}
              </p>
            )}

            {wholeMaterialAttachments.length > 0 && (
              <section className="mb-5 rounded-md border border-slate-200">
                <div className="border-b border-slate-200 px-4 py-2.5">
                  <span className="text-sm font-semibold text-slate-700">教材全体の資料</span>
                </div>
                <div className="flex flex-wrap gap-4 p-4 text-sm">
                  {wholeMaterialAttachments.map((a) =>
                    a.kind === 'link' ? (
                      <a
                        key={a.id}
                        href={a.external_url ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 hover:underline"
                      >
                        {a.filename}
                      </a>
                    ) : (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => download(a.id)}
                        className="text-blue-700 hover:underline"
                      >
                        {a.filename}
                      </button>
                    ),
                  )}
                </div>
              </section>
            )}

            {chapters.length === 0 && (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                目次がまだ登録されていません。
              </p>
            )}

            {chapters.map((chapter, chapterIndex) => (
              <div key={chapter.id} className="mb-4 rounded-md border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <span className="text-sm font-semibold text-slate-700">
                    第{chapterIndex + 1}章 {chapter.title}
                  </span>
                  <span className="text-xs text-slate-400">
                    {countCompletedPages(chapter.children, completedIds)}/{countPages(chapter.children)} 完了
                  </span>
                </div>
                <div className="p-2">
                  {chapter.children.map((child) =>
                    child.kind === 'section' ? (
                      <div key={child.id} className="ml-2 mb-1.5">
                        <div className="flex items-center gap-2 px-2 py-1">
                          <span className="text-xs font-semibold text-slate-700">{child.title}</span>
                          <span className="flex-shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                            小見出し
                          </span>
                        </div>
                        <div className="ml-4 border-l-2 border-slate-200 pl-2">
                          {child.children.map((page) => (
                            <TocPageRow key={page.id} title={page.title} kindLabel={pageKindLabel(page)} done={page.id !== null && completedIds.has(page.id)} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <TocPageRow
                        key={child.id}
                        title={child.title}
                        kindLabel={pageKindLabel(child)}
                        done={child.id !== null && completedIds.has(child.id)}
                      />
                    ),
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {activeTab === 'practice' && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            反復演習は準備中です。
          </p>
        )}

        {activeTab === 'wrong_only' && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            誤答のみ抽出は準備中です。
          </p>
        )}
      </div>
    </div>
  )
}

function countPages(nodes: EditableNode[]): number {
  let total = 0
  for (const n of nodes) {
    if (n.kind === 'page') total += 1
    total += countPages(n.children)
  }
  return total
}

function countCompletedPages(nodes: EditableNode[], completedIds: Set<number>): number {
  let total = 0
  for (const n of nodes) {
    if (n.kind === 'page' && n.id !== null && completedIds.has(n.id)) total += 1
    total += countCompletedPages(n.children, completedIds)
  }
  return total
}

function TocPageRow({ title, kindLabel, done }: { title: string; kindLabel: string; done: boolean }) {
  return (
    <div
      className="ml-2 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-slate-500"
      title="準備中（S-16実装後に受講できるようになります）"
    >
      <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] ${done ? 'bg-green-100 text-green-700' : 'border border-slate-300 text-transparent'}`}>
        {done ? '✓' : '·'}
      </span>
      <span className="flex-1 text-slate-700">{title}</span>
      <span className="flex-shrink-0 text-[10.5px] text-slate-400">{kindLabel}</span>
    </div>
  )
}
