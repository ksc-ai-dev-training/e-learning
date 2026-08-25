// 画面タイトル（詳細設計書2.1.1節）。ほぼ全画面のヘッダー部分。
// 画面ID（S-xx）は設計書・モックアップ上の識別用でしかないため、実装画面には表示しない。
export default function PageHeader({ title }: { title: string }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-8 py-[18px]">
      <h1 className="text-lg font-bold text-slate-900">{title}</h1>
    </header>
  )
}
