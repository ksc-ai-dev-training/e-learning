import { Link } from 'react-router'
import Badge from './Badge'
import Chip from './Chip'
import ProgressBar from './ProgressBar'
import { formatDateJst } from '../../lib/datetime'
import type { MyLearningItem } from '../../types'

function daysUntil(iso: string): number {
  const diffMs = new Date(iso).getTime() - Date.now()
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}

// 2026-09-17、期限超過時に「期限まであと0日」のまま表示され、実際に何日超過しているか分からない
// 不具合を修正（従来はMath.max(0, ...)で切り詰めていた）。S-08受講状況ダッシュボードの
// daysRemainingLabelと同じ考え方に揃えた。
function dueDateLabel(daysLeft: number): string {
  if (daysLeft > 0) return `期限まであと${daysLeft}日`
  if (daysLeft === 0) return '本日が期限'
  return `期限を${-daysLeft}日超過`
}

interface MaterialCardProps {
  item: MyLearningItem
  actionLabel: string
  to: string
  urgent?: boolean
}

// 教材の一覧表示カード（詳細設計書2.1.2節）。S-02マイ学習・S-03教材一覧で共通。
export default function MaterialCard({ item, actionLabel, to, urgent = false }: MaterialCardProps) {
  const passed = item.progress_status === 'completed'
  // 期限超過（overdue）は「期限が近い」urgent全体の中でもさらに目立たせる（2026-09-17新設。
  // ユーザー要望: 期限切れの必修教材が、まだ日数に余裕がある「期限が近い」ものと同じ見た目で
  // 埋もれてしまい気づきにくい）。
  const overdue = urgent && item.due_at ? daysUntil(item.due_at) < 0 : false
  return (
    <div
      className={`flex flex-wrap items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800 sm:flex-nowrap ${
        overdue
          ? 'border-l-4 border-l-red-600 bg-red-100/70 dark:bg-red-950/40'
          : urgent
            ? 'bg-red-50/40 dark:bg-red-950/20'
            : ''
      }`}
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-300">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      </div>

      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <div className="truncate text-[15px] font-semibold text-slate-800 dark:text-slate-50">{item.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-300">
          <Badge variant={item.required ? 'required' : 'optional'} />
          {item.required && item.due_at && urgent && (
            <Badge variant={overdue ? 'overdue-critical' : 'overdue'}>
              {overdue && '⚠ '}
              {dueDateLabel(daysUntil(item.due_at))}（{formatDateJst(item.due_at)}）
            </Badge>
          )}
          {item.required && item.due_at && !urgent && <span>期限: {formatDateJst(item.due_at)}</span>}
          {passed && item.completed_at && <Badge variant="complete">合格済み（{formatDateJst(item.completed_at)}）</Badge>}
          <Chip>{item.project_name}</Chip>
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-indigo-600 dark:text-indigo-300">
              #{tag}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-shrink-0">
        <ProgressBar pct={item.progress_pct} tone={passed ? 'complete' : urgent ? 'warn' : 'default'} />
      </div>

      <div className="flex-shrink-0">
        <Link
          to={to}
          className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${
            overdue
              ? 'bg-red-800 text-white ring-2 ring-red-300 hover:bg-red-900 dark:ring-red-700'
              : urgent
                ? 'bg-red-700 text-white hover:bg-red-800'
                : passed
                  ? 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          {actionLabel}
        </Link>
      </div>
    </div>
  )
}
