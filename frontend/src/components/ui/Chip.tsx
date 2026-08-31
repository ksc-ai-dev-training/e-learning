import type { ReactNode } from 'react'

// タグ・プロジェクト名チップ（詳細設計書2.1.2節）。S-02プロジェクトタブ・教材カードのタグ表示で共通。
export default function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
      {children}
    </span>
  )
}
