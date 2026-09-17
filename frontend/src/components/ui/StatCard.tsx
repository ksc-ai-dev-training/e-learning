import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { scrollToAndHighlight } from '../../lib/scrollHighlight'

const TONE_CLASSES: Record<string, string> = {
  default: 'border-slate-200 dark:border-slate-800',
  warn: 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/30',
  danger: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40',
  good: 'border-green-200 dark:border-green-900',
}

interface StatCardProps {
  label: string
  value: ReactNode
  unit?: string
  detail?: ReactNode
  tone?: 'default' | 'warn' | 'danger' | 'good'
  linkTo?: string
  onClick?: () => void
}

// 件数・数値の統計カード（詳細設計書2.1.2節）。S-02マイ学習・S-09個人学習レポートで共通。
// linkTo指定時はクリックで対象一覧へ遷移する（同一画面内アンカー、または他画面へのクエリ付きリンク）。
// onClick指定時は画面内の状態を変える用途（S-02「任意教材 受講済み」→受講済みのみの絞り込み表示）に使う。
// detailはvalueの下に添える補足（例:「12件/15件」）。リンク先／挙動の決め方は同節のcallout参照。
export default function StatCard({ label, value, unit, detail, tone = 'default', linkTo, onClick }: StatCardProps) {
  const interactive = Boolean(linkTo || onClick)
  const content = (
    <>
      <div className="text-[13px] text-slate-500 dark:text-slate-300">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-50">
        {value}
        {unit && <span className="ml-0.5 text-sm font-normal text-slate-500 dark:text-slate-300">{unit}</span>}
      </div>
      {detail && <div className="mt-0.5 text-[13px] text-slate-400 dark:text-slate-300">{detail}</div>}
      {interactive && (
        <span className="mt-1 flex items-center gap-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
          一覧を見る
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      )}
    </>
  )
  const className = `rounded-md border px-4 py-3 text-left ${TONE_CLASSES[tone]} ${interactive ? 'block hover:bg-slate-50 dark:hover:bg-slate-800/60' : ''}`

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`w-full ${className}`}>
        {content}
      </button>
    )
  }
  if (!linkTo) {
    return <div className={className}>{content}</div>
  }
  if (linkTo.startsWith('#')) {
    // 同一画面内のアンカーはネイティブのハッシュ遷移に任せない（入れ子のoverflow-y-auto
    // コンテナに対する挙動がブラウザによって不安定なため）。scrollIntoViewで明示的に
    // スクロールし、対象箇所を一瞬ハイライトして「反応した」ことを常に視覚的に伝える
    // （データが少なくスクロール自体が不要なケースでも手応えが分かるように。2026-09-03）。
    const id = linkTo.slice(1)
    return (
      <button
        type="button"
        onClick={() => scrollToAndHighlight(id)}
        className={`w-full ${className}`}
      >
        {content}
      </button>
    )
  }
  return (
    <Link to={linkTo} className={className}>
      {content}
    </Link>
  )
}
