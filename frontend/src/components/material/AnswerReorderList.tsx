import { useState } from 'react'
import Button from '../ui/Button'

// S-16並び替え設問の解答UI。項目を正しい順序でクリックしていくと1, 2, 3...の番号が付き、
// 全項目を選び終えたら「この順序で回答する」で送信する（上下ボタンでの並べ替えは直感的でない
// というフィードバックを受けて2026-09-11に変更）。選択済みの項目をもう一度クリックすると選択を
// 解除し、後続の項目は自動的に番号が詰まる（「ひとつ戻す」「やり直す」ボタンは操作性が悪いという
// フィードバックを受け、この単純なトグル方式に置き換えた）。項目自体はAIレビュー同様サーバーから
// 届いたoptionsを表示するのみで、テキスト編集はできない。
export default function AnswerReorderList({
  options,
  disabled,
  onSubmit,
  initialOrder,
}: {
  options: string[]
  disabled: boolean
  onSubmit: (order: string[]) => Promise<void>
  // 既にこのスコープ内で一度回答済み（かつ未提出のため編集可能）な場合、前回送信した並び順から
  // 再開する。無指定なら未選択の状態から開始する。
  initialOrder?: string[]
}) {
  const [order, setOrder] = useState<string[]>(initialOrder ?? [])
  const [submitting, setSubmitting] = useState(false)

  const toggle = (item: string) => {
    if (disabled) return
    setOrder(order.includes(item) ? order.filter((v) => v !== item) : [...order, item])
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
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-400">
        正しいと思う順番に項目をクリックしてください（1番目からクリック。もう一度クリックすると選択解除できます）。
      </p>
      <div className="flex flex-col gap-1.5">
        {options.map((item) => {
          const position = order.indexOf(item)
          const picked = position !== -1
          return (
            <button
              key={item}
              type="button"
              onClick={() => toggle(item)}
              disabled={disabled}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
                picked
                  ? 'border-blue-300 bg-blue-50 text-blue-900'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
              }`}
            >
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  picked ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'
                }`}
              >
                {picked ? position + 1 : ''}
              </span>
              {item}
            </button>
          )
        })}
      </div>
      {!disabled && (
        <Button
          type="button"
          variant="secondary"
          onClick={submit}
          disabled={submitting || order.length !== options.length}
          className="self-start"
        >
          {submitting ? '送信中…' : 'この順序で回答する'}
        </Button>
      )}
    </div>
  )
}
