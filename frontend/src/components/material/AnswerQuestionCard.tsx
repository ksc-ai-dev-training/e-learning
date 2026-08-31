import { useEffect, useState } from 'react'
import type { Answer, Question } from '../../types'
import { questionTypeLabel } from '../../lib/questionDefaults'
import { getMyQuestionScores } from '../../lib/attemptActions'
import { formatDateTimeJst } from '../../lib/datetime'
import Button from '../ui/Button'
import TextArea from '../ui/TextArea'
import TextInput from '../ui/TextInput'
import AnswerReorderList from './AnswerReorderList'

function StatusBadge({ answer }: { answer: Answer }) {
  if (answer.is_correct === true) {
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">回答済み・正解</span>
  }
  if (answer.is_correct === false) {
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">回答済み・不正解</span>
  }
  if (answer.ai_score_pct !== null) {
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">
        採点済み（{answer.ai_score_pct}点）
      </span>
    )
  }
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">回答済み・採点中</span>
}

// S-16の設問カード。設問種別ごとに入力UIを出し分け、ロック状態（前の必須設問が未回答の間は
// disabled表示）・ドボンバッジ・任意設問のスキップ・回答済みバッジを扱う。合否判定に使う
// 正解そのもの（correct_answer）は_fetch_tree(strip_answers=True)で受講者へ送られないため、
// 回答後も「どの選択肢が正解だったか」は表示しない（is_correctの結果のみ表示する簡略版）。
export default function AnswerQuestionCard({
  question,
  index,
  answer,
  locked,
  skipped,
  onSave,
  onSkip,
}: {
  question: Question
  index: number
  answer: Answer | undefined
  locked: boolean
  skipped: boolean
  onSave: (response: unknown) => Promise<void>
  onSkip: () => void
}) {
  const answered = answer !== undefined
  const disabled = locked || answered || skipped
  const [singleValue, setSingleValue] = useState<string>((answer?.response as string) ?? '')
  const [multiValue, setMultiValue] = useState<string[]>((answer?.response as string[]) ?? [])
  const [textValue, setTextValue] = useState<string>((answer?.response as string) ?? '')
  const [scoreValue, setScoreValue] = useState<string>(
    answer?.response && typeof answer.response === 'object' && answer.response !== null
      ? String((answer.response as { score: number }).score)
      : '',
  )
  const [submitting, setSubmitting] = useState(false)
  const [scoreHistory, setScoreHistory] = useState<{ score: number; recorded_at: string }[]>([])

  useEffect(() => {
    if (question.type !== 'score_log' || question.id === null) return
    let cancelled = false
    getMyQuestionScores(question.id)
      .then((res) => {
        if (!cancelled) setScoreHistory(res.items)
      })
      .catch(() => {
        // 履歴取得の失敗は解答自体をブロックしないため無視する
      })
    return () => {
      cancelled = true
    }
  }, [question.type, question.id, answer])

  const submit = async (response: unknown) => {
    setSubmitting(true)
    try {
      await onSave(response)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={`mb-4 rounded-md border p-4 ${
        locked
          ? 'border-slate-200 opacity-50'
          : answered || skipped
            ? 'border-slate-200'
            : 'border-blue-400 ring-2 ring-blue-100'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">
          設問{index + 1} ／ {questionTypeLabel(question.type)}
          {question.is_critical && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800">
              ⚠ ドボン
            </span>
          )}
          {!question.required && <span className="ml-2 text-[11px] font-normal text-slate-400">（任意）</span>}
        </span>
        {locked && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
            設問{index}に回答すると解放されます
          </span>
        )}
        {!locked && answered && <StatusBadge answer={answer} />}
        {!locked && !answered && skipped && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-400">スキップ済み</span>
        )}
        {!locked && !answered && !skipped && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">回答中</span>
        )}
      </div>

      <div className="mb-3 text-sm text-slate-800">{question.prompt}</div>

      {question.type === 'single' && (
        <div className="flex flex-col gap-1.5">
          {(question.options ?? []).map((opt) => (
            <label key={opt} className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${disabled ? 'border-slate-200 text-slate-400' : 'border-slate-200 hover:bg-slate-50'}`}>
              <input
                type="radio"
                name={`q-${question.id}`}
                checked={singleValue === opt}
                disabled={disabled || submitting}
                onChange={() => {
                  setSingleValue(opt)
                  submit(opt)
                }}
              />
              {opt}
            </label>
          ))}
        </div>
      )}

      {question.type === 'multi' && (
        <div className="flex flex-col gap-1.5">
          {(question.options ?? []).map((opt) => (
            <label key={opt} className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${disabled ? 'border-slate-200 text-slate-400' : 'border-slate-200 hover:bg-slate-50'}`}>
              <input
                type="checkbox"
                checked={multiValue.includes(opt)}
                disabled={disabled || submitting}
                onChange={(e) =>
                  setMultiValue(e.target.checked ? [...multiValue, opt] : multiValue.filter((v) => v !== opt))
                }
              />
              {opt}
            </label>
          ))}
          {!disabled && (
            <Button variant="secondary" onClick={() => submit(multiValue)} disabled={submitting} className="mt-1 self-start">
              {submitting ? '送信中…' : '回答する'}
            </Button>
          )}
        </div>
      )}

      {question.type === 'reorder' && !disabled && (
        <AnswerReorderList options={question.options ?? []} disabled={submitting} onSubmit={submit} />
      )}
      {question.type === 'reorder' && disabled && (question.options ?? []).length > 0 && (
        <ul className="list-inside list-decimal text-sm text-slate-400">
          {(question.options ?? []).map((opt) => (
            <li key={opt}>{opt}</li>
          ))}
        </ul>
      )}

      {(question.type === 'free_text' || question.type === 'code') && (
        <div className="flex flex-col gap-2">
          {question.type === 'code' && question.code_language && (
            <span className="self-start rounded bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-100">
              {question.code_language}
            </span>
          )}
          <TextArea
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            disabled={disabled || submitting}
            rows={question.type === 'code' ? 6 : 3}
            className={question.type === 'code' ? 'font-mono text-[13px] leading-relaxed' : ''}
            placeholder={disabled ? undefined : '回答を入力してください'}
          />
          {!disabled && (
            <Button variant="secondary" onClick={() => submit(textValue)} disabled={submitting || !textValue.trim()} className="self-start">
              {submitting ? '送信中…' : '回答する'}
            </Button>
          )}
          <p className="text-xs text-slate-400">
            ※ {question.type === 'code' ? 'コード記述式' : '記述式'}はAIまたはプロジェクト担当者が採点します（教材の設定による）。結果を待たずに次の設問へ進められます。
          </p>
        </div>
      )}

      {question.type === 'score_log' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <TextInput
              type="number"
              value={scoreValue}
              onChange={(e) => setScoreValue(e.target.value)}
              disabled={disabled || submitting}
              className="w-32"
              placeholder="数値"
            />
            <span className="text-xs text-slate-500">{question.score_unit}</span>
            {!disabled && (
              <Button
                variant="secondary"
                onClick={() => submit({ score: Number(scoreValue) })}
                disabled={submitting || scoreValue.trim() === '' || Number.isNaN(Number(scoreValue))}
              >
                {submitting ? '送信中…' : '記録する'}
              </Button>
            )}
          </div>
          {scoreHistory.length > 0 && (
            <p className="text-xs text-slate-400">
              これまでの記録:{' '}
              {scoreHistory
                .map((h) => `${h.score}（${formatDateTimeJst(h.recorded_at)}）`)
                .join(' ／ ')}
            </p>
          )}
        </div>
      )}

      {!locked && !answered && !question.required && !skipped && (
        <p className="mt-2 text-xs text-slate-500">
          この設問は回答任意です。
          <button type="button" onClick={onSkip} className="ml-1 text-blue-700 hover:underline">
            スキップして次へ
          </button>
        </p>
      )}
    </div>
  )
}
