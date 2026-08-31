import type { ReactNode } from 'react'

interface PanelProps {
  title: string
  count?: ReactNode
  tone?: 'default' | 'warn'
  children: ReactNode
}

// タイトル付きの枠線カード（詳細設計書2.1.2節）。設定画面・詳細画面のセクション分けで多用。
export default function Panel({ title, count, tone = 'default', children }: PanelProps) {
  const borderClass = tone === 'warn' ? 'border-red-300' : 'border-slate-200'
  const headerClass = tone === 'warn' ? 'bg-red-50' : 'bg-slate-50'
  return (
    <section className={`mb-5 rounded-md border ${borderClass}`}>
      <div className={`flex items-center justify-between border-b ${borderClass} ${headerClass} px-4 py-2.5`}>
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        {count && <span className="text-xs text-slate-400">{count}</span>}
      </div>
      {children}
    </section>
  )
}
