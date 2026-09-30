import { Link } from 'react-router'

// S-04（目次）・S-16（教材受講ページのミニ目次サイドバー）共通のページ行。
// isCurrent: 目次画面の「続きはここから」ブックマーク（material.progress.current_node_id）。
// isViewing: 今まさに開いているページ（MaterialTocSidebar専用。ブックマークとは別の概念で、
// 行全体を背景色でハイライトする。2026-09-29）。
export default function TocPageRow({
  materialId,
  nodeId,
  title,
  kindLabel,
  done,
  isCurrent = false,
  isViewing = false,
  query = '',
}: {
  materialId: number
  nodeId: number | null
  title: string
  kindLabel: string
  done: boolean
  isCurrent?: boolean
  isViewing?: boolean
  query?: string
}) {
  if (nodeId === null) {
    return (
      <div className="ml-2 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-slate-400 dark:text-neutral-500">
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-slate-300 text-transparent dark:border-neutral-600">·</span>
        <span className="flex-1">{title}</span>
        <span className="flex-shrink-0 text-[10.5px] text-slate-400 dark:text-neutral-500">{kindLabel}</span>
      </div>
    )
  }
  const circleClass = done
    ? 'bg-green-600 text-white'
    : isCurrent
      ? 'bg-blue-800 text-white dark:bg-blue-500'
      : 'border border-slate-300 text-transparent dark:border-neutral-600'
  return (
    <Link
      to={`/materials/${materialId}/pages/${nodeId}${query}`}
      className={`ml-2 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-slate-500 hover:bg-blue-50 dark:text-neutral-300 dark:hover:bg-blue-950/40 ${
        isViewing ? 'bg-blue-50 font-semibold text-slate-800 dark:bg-blue-950/40 dark:text-neutral-100' : ''
      }`}
    >
      <span
        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] ${circleClass}`}
        title={isCurrent ? '続きはここから' : undefined}
      >
        {done ? '✓' : isCurrent ? '●' : '·'}
      </span>
      <span className="max-sm:break-keep flex-1 text-slate-700 dark:text-neutral-200">{title}</span>
      <span className="flex-shrink-0 text-[10.5px] text-slate-400 dark:text-neutral-500">{kindLabel}</span>
    </Link>
  )
}
