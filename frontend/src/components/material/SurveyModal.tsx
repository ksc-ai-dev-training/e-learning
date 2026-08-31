import { useState } from 'react'
import type { Survey } from '../../types'
import { ApiError } from '../../lib/api'
import { submitSurveyResponse } from '../../lib/attemptActions'
import Button from '../ui/Button'
import TextArea from '../ui/TextArea'

// 受験後アンケート回答モーダル（F-28）。S-04のcallout・S-16の章完了時から開く。
// 回答はすべて任意でスキップ可（未入力の設問はsurvey_answersの行を作らず送信しない）。
export default function SurveyModal({
  survey,
  onClose,
  onSubmitted,
}: {
  survey: Survey
  onClose: () => void
  onSubmitted: () => void
}) {
  const [values, setValues] = useState<Record<number, unknown>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setValue = (qid: number, value: unknown) => setValues((prev) => ({ ...prev, [qid]: value }))

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const answers = Object.entries(values)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([qid, value]) => ({ survey_question_id: Number(qid), value }))
      await submitSurveyResponse(survey.id, answers)
      onSubmitted()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-bold text-slate-900">{survey.title}</h2>
        <p className="mb-4 text-xs text-slate-500">回答は任意です。スキップできます。</p>
        <div className="flex flex-col gap-4">
          {survey.questions.map((q) => (
            <div key={q.id}>
              <p className="mb-2 text-sm text-slate-700">{q.prompt}</p>
              {q.type === 'rating_5' && (
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setValue(q.id, n)}
                      className={`h-9 w-9 rounded-md border text-sm font-semibold ${
                        values[q.id] === n
                          ? 'border-blue-800 bg-blue-900 text-white'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
              {q.type === 'single_choice' && (
                <div className="flex flex-col gap-1.5">
                  {(q.options ?? []).map((opt) => (
                    <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={`survey-q-${q.id}`}
                        checked={values[q.id] === opt}
                        onChange={() => setValue(q.id, opt)}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              )}
              {q.type === 'free_text' && (
                <TextArea
                  rows={2}
                  value={(values[q.id] as string) ?? ''}
                  onChange={(e) => setValue(q.id, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            今回はスキップ
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? '送信中…' : '回答する'}
          </Button>
        </div>
      </div>
    </div>
  )
}
