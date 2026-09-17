import type { ReactNode } from 'react'

// タグ・プロジェクト名チップ（詳細設計書2.1.2節）。S-02プロジェクトタブ・教材カードのタグ表示で共通。
export default function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[12.5px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
      {children}
    </span>
  )
}
