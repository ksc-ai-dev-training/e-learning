import { useState } from 'react'
import Button from '../ui/Button'

// S-16並び替え設問の解答UI。QuestionEditCardのReorderEditorと同じ上下ボタンの操作感を踏襲するが、
// こちらは項目のテキスト編集はできず（項目自体はAIレビュー同様サーバーから届いたoptionsを表示するのみ）、
// 並び順（response）だけをローカルで組み替えて「この順序で回答する」で送信する。
export default function AnswerReorderList({
  options,
  disabled,
  onSubmit,
}: {
  options: string[]
  disabled: boolean
  onSubmit: (order: string[]) => Promise<void>
}) {
  const [order, setOrder] = useState<string[]>(options)
  const [submitting, setSubmitting] = useState(false)

  const move = (i: number, dir: -1 | 1) => {
    const target = i + dir
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[i], next[target]] = [next[target], next[i]]
    setOrder(next)
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      await onSubmit(order)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {order.map((item, i) => (
        <div key={item + i} className="flex items-center gap-2">
          <span className="w-5 flex-shrink-0 text-xs text-slate-400">{i + 1}.</span>
          <span className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm">{item}</span>
          <button
            type="button"
            onClick={() => move(i, -1)}
            disabled={disabled || i === 0}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => move(i, 1)}
            disabled={disabled || i === order.length - 1}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
          >
            ↓
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={submit}
        disabled={disabled || submitting}
        className="mt-1 self-start"
      >
        {submitting ? '送信中…' : 'この順序で回答する'}
      </Button>
    </div>
  )
}
