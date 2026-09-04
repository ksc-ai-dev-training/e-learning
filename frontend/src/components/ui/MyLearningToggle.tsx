import { useState } from 'react'
import { Bookmark } from 'lucide-react'
import { apiFetch } from '../../lib/api'

interface MyLearningToggleProps {
  materialId: number
  registered: boolean
  onToggled: () => void | Promise<void>
}

// マイ学習への登録/解除トグル（F-31）。全社Wiki所属の任意教材の行にのみ表示する（呼び出し側で判定）。
// 登録済みは塗りつぶしアイコン＋青、未登録は輪郭アイコン＋グレーで状態を一目で区別できるようにする
// （当初はテキストリンクのみだったが、一覧で登録状態が分かりにくいというフィードバックを受けて変更した。2026-08-31）。
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
      onClick={handleClick}
      disabled={loading}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 ${
        registered
          ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
          : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'
      }`}
    >
      <Bookmark className="h-3.5 w-3.5" fill={registered ? 'currentColor' : 'none'} />
      {registered ? 'マイ学習から外す' : 'マイ学習に追加'}
    </button>
  )
}
