import { useState } from 'react'
import { apiFetch } from '../../lib/api'

interface MyLearningToggleProps {
  materialId: number
  registered: boolean
  onToggled: () => void | Promise<void>
}

// マイ学習への登録/解除トグル（F-31）。全社ライブラリ所属の任意教材の行にのみ表示する（呼び出し側で判定）。
// 「受講する」等の主操作ボタンと形自体が違って見えるよう、スイッチ（トグル）の見た目にした
// （2026-09-25。ボタン同士だと大きさを揃えるほど見分けにくく誤クリックしやすいという指摘を受け、
// このコントロールはON/OFFの状態が分かればよいものなので、ボタンと張り合わない見た目に変更した。
// ラベルは「マイ学習」で固定し、状態はスイッチの色・つまみの位置だけで示す）。
// S-03（教材一覧・検索）・S-04（教材受講：目次）・S-16（教材受講：ページ）で共通。
export default function MyLearningToggle({ materialId, registered, onToggled }: MyLearningToggleProps) {
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      await apiFetch(`/api/materials/${materialId}/my-learning`, { method: registered ? 'DELETE' : 'PUT' })
      await onToggled()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={registered}
      onClick={handleClick}
      disabled={loading}
      title={registered ? 'マイ学習から外す' : 'マイ学習に追加'}
      className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-slate-500 disabled:opacity-50 dark:text-slate-400"
    >
      マイ学習
      <span
        className={`flex h-4 w-7 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
          registered ? 'bg-blue-600 dark:bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
            registered ? 'translate-x-3' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}
