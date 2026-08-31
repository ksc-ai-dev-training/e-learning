// 進捗率バー（詳細設計書2.1.2節）。S-02教材カード・S-04教材全体の進捗で共通。
export default function ProgressBar({ pct, tone = 'default' }: { pct: number; tone?: 'default' | 'warn' | 'complete' }) {
  const fillClass =
    tone === 'complete' ? 'bg-green-600' : tone === 'warn' ? 'bg-amber-500' : 'bg-blue-700'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${fillClass}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="w-9 flex-shrink-0 text-right text-xs text-slate-500">{pct}%</span>
    </div>
  )
}
