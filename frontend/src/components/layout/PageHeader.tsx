import type { ReactNode } from 'react'

// 画面タイトル（詳細設計書2.1.1節）。ほぼ全画面のヘッダー部分。
// 画面ID（S-xx）は設計書・モックアップ上の識別用でしかないため、実装画面には表示しない。
// actionsは画面モックアップのheader-actions相当（S-05の下書き保存・公開する等）。設定パネルの
// 長さに関わらず常に同じ位置に表示するため、本文中に置かず必ずここに渡す（2026-08-28）。
// AppShellの本文スクロールコンテナ（overflow-y-auto）の先頭に来るため、sticky top-0で
// スクロールしても常に見える位置に固定する（2026-09-03、ユーザー要望）。
export default function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-8 py-[18px]">
      <h1 className="text-lg font-bold text-slate-900">{title}</h1>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
