// 進捗率バー（詳細設計書2.1.2節）。S-02教材カード・S-04教材全体の進捗で共通。
// tone="complete"の場合、パーセンテージの左横に受講済みを示すチェックマークを付ける
// （2026-09-03、ユーザー要望。既存の「合格済み」タグはタグ列の中で見落としやすいため）。
export default function ProgressBar({ pct, tone = 'default' }: { pct: number; tone?: 'default' | 'warn' | 'complete' }) {
  const fillClass =
    tone === 'complete' ? 'bg-green-600' : tone === 'warn' ? 'bg-amber-500' : 'bg-blue-700'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${fillClass}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="flex w-12 flex-shrink-0 items-center justify-end gap-0.5 text-xs text-slate-500">
        {tone === 'complete' && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-green-600"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {pct}%
      </span>
    </div>
  )
}
