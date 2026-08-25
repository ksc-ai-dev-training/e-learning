// 画面タイトル＋画面ID（詳細設計書2.1.1節）。ほぼ全画面のヘッダー部分。
export default function PageHeader({ title, screenId }: { title: string; screenId?: string }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-8 py-[18px]">
      <div className="flex items-baseline gap-2.5">
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        {screenId && (
          <span className="rounded border border-slate-300 px-1.5 text-[11px] font-semibold text-slate-400">
            {screenId}
          </span>
        )}
      </div>
    </header>
  )
}
