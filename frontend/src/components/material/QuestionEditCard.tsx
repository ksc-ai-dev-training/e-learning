import type { Question, QuestionType } from '../../types'
import { emptyQuestionForType, questionTypeLabel, supportsGradingModeOverride } from '../../lib/questionDefaults'
import Select from '../ui/Select'
import TextArea from '../ui/TextArea'
import TextInput from '../ui/TextInput'

const GRADING_MODE_OPTIONS = [
  { value: '', label: '教材既定に従う' },
  { value: 'ai', label: 'AI自動採点' },
  { value: 'manual', label: '手動採点' },
]

const FEEDBACK_STYLE_OPTIONS = [
  { value: '', label: '教材既定に従う' },
  { value: 'show_answer', label: '正解提示' },
  { value: 'review_only', label: 'コードレビュー型' },
  { value: 'hint_only', label: 'ヒント型' },
]

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = (
  ['single', 'multi', 'reorder', 'free_text', 'code', 'score_log'] as const
).map((value) => ({ value, label: questionTypeLabel(value) }))

// 設問編集カード（詳細設計書2.1.6節）。S-05目次編集タブ・S-17ページ編集で共通利用する想定だが、
// 今回はS-17でのみ初実装する。単一選択・複数選択・並び替え・記述式・コード記述式・スコア記録の6種すべてを編集できる。
export default function QuestionEditCard({
  question,
  index,
  onChange,
  onDelete,
}: {
  question: Question
  index: number
  onChange: (q: Question) => void
  onDelete: () => void
}) {
  const typeLabel = TYPE_OPTIONS.find((t) => t.value === question.type)?.label ?? question.type
  const isScoreLog = question.type === 'score_log'
  const gradingOverridable = supportsGradingModeOverride(question.type)
  const feedbackDisabled = gradingOverridable && question.grading_mode === 'manual'

  const changeType = (value: string) => onChange(emptyQuestionForType(value as QuestionType))

  const changeGradingMode = (value: string) =>
    onChange({ ...question, grading_mode: value === '' ? null : (value as 'ai' | 'manual') })
  const changeFeedbackStyle = (value: string) =>
    onChange({ ...question, feedback_style: value === '' ? null : (value as Question['feedback_style']) })

  return (
    <div className="mb-3 rounded-md border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">
          設問{index + 1}（{typeLabel}）
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
        >
          削除
        </button>
      </div>

      <div className="mb-2 flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">種別</label>
        <Select value={question.type} onChange={changeType} options={TYPE_OPTIONS} className="w-40" />
      </div>

      <div className="mb-2 flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">設問文</label>
        <TextArea
          value={question.prompt}
          onChange={(e) => onChange({ ...question, prompt: e.target.value })}
          rows={2}
        />
      </div>

      {(question.type === 'single' || question.type === 'multi') && (
        <OptionsEditor question={question} onChange={onChange} />
      )}
      {question.type === 'reorder' && <ReorderEditor question={question} onChange={onChange} />}
      {(question.type === 'free_text' || question.type === 'code') && (
        <FreeTextCodeEditor question={question} onChange={onChange} />
      )}
      {isScoreLog && <ScoreLogEditor question={question} onChange={onChange} />}

      <div className="mt-2 flex flex-wrap gap-6">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">回答</label>
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={question.required}
                onChange={() => onChange({ ...question, required: true })}
              />
              必須
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={!question.required}
                onChange={() => onChange({ ...question, required: false })}
              />
              任意（スキップ可）
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">ドボン問題</label>
          <label
            className={`flex items-center gap-1 text-xs ${isScoreLog ? 'opacity-40' : ''}`}
            title={isScoreLog ? 'スコア記録型には設定できません' : undefined}
          >
            <input
              type="checkbox"
              checked={question.is_critical}
              disabled={isScoreLog}
              onChange={(e) => onChange({ ...question, is_critical: e.target.checked })}
            />
            この設問にする
          </label>
        </div>
        {gradingOverridable && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">採点方式（この設問のみ上書き）</label>
            <Select
              value={question.grading_mode ?? ''}
              onChange={changeGradingMode}
              options={GRADING_MODE_OPTIONS}
              className="w-40"
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">AI講評スタイル（この設問のみ上書き）</label>
          <Select
            value={question.feedback_style ?? ''}
            onChange={changeFeedbackStyle}
            options={FEEDBACK_STYLE_OPTIONS}
            disabled={feedbackDisabled}
            className="w-40"
          />
        </div>
      </div>
    </div>
  )
}

function OptionsEditor({ question, onChange }: { question: Question; onChange: (q: Question) => void }) {
  const options = question.options ?? []
  const isMulti = question.type === 'multi'
  const correctList = isMulti
    ? ((question.correct_answer as string[] | null) ?? [])
    : question.correct_answer
      ? [question.correct_answer as string]
      : []
  const correctSet = new Set(correctList)

  const updateOption = (i: number, value: string) => {
    const prevValue = options[i]
    const nextOptions = options.map((o, idx) => (idx === i ? value : o))
    let nextCorrect = question.correct_answer
    if (isMulti) {
      const arr = (question.correct_answer as string[] | null) ?? []
      if (arr.includes(prevValue)) {
        nextCorrect = arr.map((v) => (v === prevValue ? value : v))
      }
    } else if (question.correct_answer === prevValue) {
      nextCorrect = value
    }
    onChange({ ...question, options: nextOptions, correct_answer: nextCorrect })
  }

  const toggleCorrect = (i: number) => {
    const value = options[i]
    if (isMulti) {
      const arr = (question.correct_answer as string[] | null) ?? []
      const nextArr = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
      onChange({ ...question, correct_answer: nextArr })
    } else {
      onChange({ ...question, correct_answer: value })
    }
  }

  const addOption = () => onChange({ ...question, options: [...options, ''] })

  const removeOption = (i: number) => {
    const value = options[i]
    const nextOptions = options.filter((_, idx) => idx !== i)
    let nextCorrect = question.correct_answer
    if (isMulti) {
      nextCorrect = ((question.correct_answer as string[] | null) ?? []).filter((v) => v !== value)
    } else if (question.correct_answer === value) {
      nextCorrect = null
    }
    onChange({ ...question, options: nextOptions, correct_answer: nextCorrect })
  }

  return (
    <div className="mb-2 flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500">選択肢（正解にチェック）</label>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type={isMulti ? 'checkbox' : 'radio'} checked={correctSet.has(opt)} onChange={() => toggleCorrect(i)} />
          <TextInput value={opt} onChange={(e) => updateOption(i, e.target.value)} className="flex-1" />
          <button
            type="button"
            onClick={() => removeOption(i)}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addOption}
        className="mt-1 self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
      >
        + 選択肢を追加
      </button>
    </div>
  )
}

function FreeTextCodeEditor({ question, onChange }: { question: Question; onChange: (q: Question) => void }) {
  return (
    <div className="mb-2 flex flex-col gap-2">
      {question.type === 'code' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">言語ヒント</label>
          <TextInput
            value={question.code_language ?? ''}
            onChange={(e) => onChange({ ...question, code_language: e.target.value })}
            placeholder="例: python"
            className="w-40"
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">AI採点基準</label>
        <TextArea
          value={question.scoring_criteria ?? ''}
          onChange={(e) => onChange({ ...question, scoring_criteria: e.target.value })}
          rows={3}
          placeholder="模範解答・採点の観点を記述してください"
        />
      </div>
    </div>
  )
}

function ScoreLogEditor({ question, onChange }: { question: Question; onChange: (q: Question) => void }) {
  return (
    <div className="mb-2 flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500">スコアの単位</label>
      <TextInput
        value={question.score_unit ?? ''}
        onChange={(e) => onChange({ ...question, score_unit: e.target.value })}
        placeholder="例: WPM、秒、点"
        className="w-40"
      />
      <span className="text-xs text-slate-400">正解の概念はなく、受講者が入力した値をそのまま記録します。</span>
    </div>
  )
}

function ReorderEditor({ question, onChange }: { question: Question; onChange: (q: Question) => void }) {
  const items = (question.correct_answer as string[] | null) ?? []

  const updateItem = (i: number, value: string) => {
    onChange({ ...question, correct_answer: items.map((v, idx) => (idx === i ? value : v)) })
  }
  const addItem = () => onChange({ ...question, correct_answer: [...items, ''] })
  const removeItem = (i: number) => onChange({ ...question, correct_answer: items.filter((_, idx) => idx !== i) })
  const moveItem = (i: number, dir: -1 | 1) => {
    const target = i + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[i], next[target]] = [next[target], next[i]]
    onChange({ ...question, correct_answer: next })
  }

  return (
    <div className="mb-2 flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500">正しい順番（この並びが正解になります）</label>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 flex-shrink-0 text-xs text-slate-400">{i + 1}.</span>
          <TextInput value={item} onChange={(e) => updateItem(i, e.target.value)} className="flex-1" />
          <button
            type="button"
            onClick={() => moveItem(i, -1)}
            disabled={i === 0}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => moveItem(i, 1)}
            disabled={i === items.length - 1}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => removeItem(i)}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="mt-1 self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
      >
        + 項目を追加
      </button>
    </div>
  )
}
