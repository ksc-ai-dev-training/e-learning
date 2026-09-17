import type { ReactNode } from 'react'

interface PanelProps {
  title: string
  count?: ReactNode
  // warn: 期限超過など「今すぐ対応が必要」な警告用（赤、Badgeのoverdueと同系統）。
  // required: 「必修」であることを示すだけの区分用（indigo。warnの赤とは別系統にし、
  // マイ学習で「期限が近い必修教材」パネル〔warn〕と「必修教材」パネル自体が同じ赤で
  // 並んで見分けにくくならないようにする。2026-09-16、ユーザー要望）。
  tone?: 'default' | 'warn' | 'required'
  children: ReactNode
}

// タイトル付きの枠線カード（詳細設計書2.1.2節）。設定画面・詳細画面のセクション分けで多用。
export default function Panel({ title, count, tone = 'default', children }: PanelProps) {
  const borderClass =
    tone === 'warn'
      ? 'border-red-300 dark:border-red-900'
      : tone === 'required'
        ? 'border-indigo-200 dark:border-indigo-900'
        : 'border-slate-200 dark:border-slate-800'
  const headerClass =
    tone === 'warn'
      ? 'bg-red-50 dark:bg-red-950/40'
      : tone === 'required'
        ? 'bg-indigo-50 dark:bg-indigo-950/40'
        : 'bg-slate-50 dark:bg-slate-800/60'
  return (
    // パネルの面を背景より明るくして区別するのではなく、枠線と文字の明るさだけで区別する
    // （2026-09-17、ユーザー指摘。面を明るくすると白い箱が浮いて見える不具合の再発になるため）。
    <section className={`mb-5 rounded-md border bg-white dark:bg-slate-900 ${borderClass}`}>
      <div className={`flex items-center justify-between border-b ${borderClass} ${headerClass} px-4 py-2.5`}>
        <span className="text-[15px] font-semibold text-slate-700 dark:text-slate-50">{title}</span>
        {count && <span className="text-[13px] text-slate-400 dark:text-slate-300">{count}</span>}
      </div>
      {children}
    </section>
  )
}
