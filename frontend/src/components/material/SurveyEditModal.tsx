import { useState } from 'react'
import Button from '../ui/Button'
import Select from '../ui/Select'
import TextArea from '../ui/TextArea'
import TextInput from '../ui/TextInput'
import { deleteSurvey, emptySurveyQuestion, upsertSurvey } from '../../lib/surveyActions'
import { ApiError } from '../../lib/api'
import type { Survey, SurveyQuestion } from '../../types'

const TYPE_OPTIONS = [
  { value: 'rating_5', label: '5段階評価' },
  { value: 'single_choice', label: '単一選択' },
  { value: 'free_text', label: '自由記述' },
]

// 受験後アンケートの設置・編集モーダル（詳細設計書10.5節・基本設計書5.28節）。
// 教材全体（nodeId=null）・章（nodeId指定）のどちらにも使う。
export default function SurveyEditModal({
  materialId,
  nodeId,
  targetLabel,
  existing,
  onClose,
  onSaved,
}: {
  materialId: number
  nodeId: number | null
  targetLabel: string
  existing: Survey | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(existing?.title ?? `${targetLabel}のアンケート`)
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)
  const [repeatMode, setRepeatMode] = useState<'once' | 'every_time'>(existing?.repeat_mode ?? 'once')
  const [questions, setQuestions] = useState<SurveyQuestion[]>(existing?.questions ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addQuestion = () => setQuestions((prev) => [...prev, emptySurveyQuestion('rating_5')])
  const updateQuestion = (i: number, q: SurveyQuestion) =>
    setQuestions(questions.map((old, idx) => (idx === i ? q : old)))
  const deleteQuestion = (i: number) => setQuestions(questions.filter((_, idx) => idx !== i))

  const save = async () => {
    setError(null)
    if (!title.trim()) {
      setError('アンケートのタイトルを入力してください')
      return
    }
    if (questions.length === 0) {
      setError('設問を1つ以上追加してください')
      return
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      if (!q.prompt.trim()) {
        setError(`設問${i + 1}: 設問文を入力してください`)
        return
      }
      if (q.type === 'single_choice' && (q.options ?? []).filter((o) => o.trim()).length < 2) {
        setError(`設問${i + 1}: 選択肢を2つ以上入力してください`)
        return
      }
    }
    setSaving(true)
    try {
      await upsertSurvey(materialId, { node_id: nodeId, title, is_active: isActive, repeat_mode: repeatMode, questions })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    setSaving(true)
    try {
      await deleteSurvey(materialId, existing.id)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '解除に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-md bg-white p-5 shadow-lg">
        <h2 className="mb-4 text-base font-bold text-slate-800">
          受験後アンケートの設置 — {targetLabel}
        </h2>

        {error && (
          <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="mb-3 flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">アンケートのタイトル</label>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>

        <div className="mb-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            設置する（ONで受講者に表示）
          </label>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500">表示回数</label>
            <Select
              value={repeatMode}
              onChange={(v) => setRepeatMode(v as 'once' | 'every_time')}
              options={[
                { value: 'once', label: '初回のみ' },
                { value: 'every_time', label: '毎回' },
              ]}
              className="w-28"
            />
          </div>
        </div>

        <div className="mb-3">
          <span className="text-xs font-semibold text-slate-500">設問</span>
          {questions.map((q, i) => (
            <div key={i} className="mb-2 rounded-md border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <Select
                  value={q.type}
                  onChange={(v) => updateQuestion(i, emptySurveyQuestion(v as SurveyQuestion['type']))}
                  options={TYPE_OPTIONS}
                  className="w-32"
                />
                <button
                  type="button"
                  onClick={() => deleteQuestion(i)}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  削除
                </button>
              </div>
              <TextArea
                value={q.prompt}
                onChange={(e) => updateQuestion(i, { ...q, prompt: e.target.value })}
                rows={2}
                placeholder="設問文"
                className="mb-2 w-full"
              />
              {q.type === 'single_choice' && (
                <div className="flex flex-col gap-1.5">
                  {(q.options ?? []).map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <TextInput
                        value={opt}
                        onChange={(e) =>
                          updateQuestion(i, {
                            ...q,
                            options: (q.options ?? []).map((o, idx) => (idx === oi ? e.target.value : o)),
                          })
                        }
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateQuestion(i, { ...q, options: (q.options ?? []).filter((_, idx) => idx !== oi) })
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                      >
                        削除
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => updateQuestion(i, { ...q, options: [...(q.options ?? []), ''] })}
                    className="self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    + 選択肢を追加
                  </button>
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addQuestion}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            + 設問を追加
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div>
            {existing && (
              <Button variant="secondary" onClick={remove} disabled={saving}>
                設置を解除する
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
