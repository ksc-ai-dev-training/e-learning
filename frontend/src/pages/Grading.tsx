import { useMemo, useState } from 'react'
import PageHeader from '../components/layout/PageHeader'
import Panel from '../components/ui/Panel'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import TextArea from '../components/ui/TextArea'
import { useMe } from '../hooks/useMe'
import { useGradingQueue } from '../hooks/useGradingQueue'
import { reviewAnswer } from '../lib/gradingActions'
import { formatDateJst } from '../lib/datetime'
import type { GradingQueueAnswer, GradingQueueMaterial } from '../types'

// S-20 採点（未採点キュー）。記述式・コード記述式のうち採点方式が「プロジェクト担当者が手動採点」で
// まだ採点していない回答だけを、教材ごとにまとめて表示する。設問の傾向を見直す場合はS-05「問題一覧」
// タブ→S-19（設問別の回答・結果一覧）を使う（本画面は採点の処理に特化）。
export default function Grading() {
  const { me } = useMe()
  const [scopeAll, setScopeAll] = useState(false)
  const { data, isLoading, mutate } = useGradingQueue(scopeAll)
  const [projectFilter, setProjectFilter] = useState('')
  const [materialFilter, setMaterialFilter] = useState('')
  const [target, setTarget] = useState<{ material: GradingQueueMaterial; answer: GradingQueueAnswer } | null>(null)

  const materials = useMemo(() => data?.materials ?? [], [data])

  const projectOptions = useMemo(() => {
    const names = Array.from(new Set(materials.map((m) => m.project_name)))
    return [{ value: '', label: 'すべてのプロジェクト' }, ...names.map((p) => ({ value: p, label: p }))]
  }, [materials])

  const materialOptions = useMemo(
    () => [
      { value: '', label: 'すべての教材' },
      ...materials
        .filter((m) => !projectFilter || m.project_name === projectFilter)
        .map((m) => ({ value: String(m.material_id), label: m.material_title })),
    ],
    [materials, projectFilter],
  )

  const visibleMaterials = materials.filter(
    (m) =>
      (!projectFilter || m.project_name === projectFilter) &&
      (!materialFilter || String(m.material_id) === materialFilter),
  )
  const totalPending = visibleMaterials.reduce((sum, m) => sum + m.answers.length, 0)
  const oldestSubmittedAt = visibleMaterials
    .flatMap((m) => m.answers.map((a) => a.submitted_at))
    .sort()[0]

  const handleSaved = async () => {
    setTarget(null)
    await mutate()
  }

  return (
    <div>
      <PageHeader title="採点" />
      <div className="px-8 py-6">
        <p className="mb-4 max-w-3xl text-sm text-slate-500">
          記述式・コード記述式の設問のうち<strong>採点方式が「プロジェクト担当者が手動採点」で、まだ採点していない回答</strong>
          だけを、教材ごとにまとめて表示します。設問の傾向を見て内容を見直したい場合はS-05「問題一覧」タブ→S-19（設問別の回答・結果一覧）を使ってください。
        </p>

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">プロジェクトで絞り込み</label>
            <Select
              value={projectFilter}
              onChange={(v) => {
                setProjectFilter(v)
                setMaterialFilter('')
              }}
              options={projectOptions}
              className="w-56"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">教材で絞り込み</label>
            <Select value={materialFilter} onChange={setMaterialFilter} options={materialOptions} className="w-56" />
          </div>
          {me?.role === 'admin' && (
            <label className="mb-2 flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)} />
              全プロジェクトを表示
            </label>
          )}
        </div>

        <div className="mb-5 flex gap-4">
          <StatTile label="未採点の合計" value={`${totalPending}件`} warn={totalPending > 0} />
          <StatTile label="対象教材" value={`${visibleMaterials.length}件`} />
          <StatTile label="最も古い未採点" value={oldestSubmittedAt ? formatDateJst(oldestSubmittedAt) : '—'} />
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-400">読み込み中...</p>
        ) : visibleMaterials.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
            未採点の回答はありません。
          </p>
        ) : (
          visibleMaterials.map((m) => (
            <Panel
              key={m.material_id}
              title={m.material_title}
              count={`${m.project_name} ／ 未採点${m.answers.length}件`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-400">
                      <th className="px-4 py-2 text-left font-normal">設問</th>
                      <th className="px-4 py-2 text-left font-normal">受講者</th>
                      <th className="px-4 py-2 text-left font-normal">回答内容</th>
                      <th className="px-4 py-2 text-left font-normal">提出日</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.answers.map((a) => (
                      <tr key={a.answer_id} className="border-b border-slate-50">
                        <td className="max-w-[230px] whitespace-normal px-4 py-2.5">
                          <div>{a.node_path}</div>
                          <div className="text-[11.5px] text-slate-400">設問「{a.prompt}」</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">{a.user_name}</td>
                        <td className="max-w-[320px] whitespace-normal px-4 py-2.5">{a.response_excerpt}</td>
                        <td className="whitespace-nowrap px-4 py-2.5">{formatDateJst(a.submitted_at)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            className="h-8 px-2.5 text-xs"
                            onClick={() => setTarget({ material: m, answer: a })}
                          >
                            採点する
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))
        )}
      </div>

      {target && (
        <GradingModal
          material={target.material}
          answer={target.answer}
          onClose={() => setTarget(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

function StatTile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border px-4 py-2.5 ${warn ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-bold text-slate-800">{value}</div>
    </div>
  )
}

function GradingModal({
  material,
  answer,
  onClose,
  onSaved,
}: {
  material: GradingQueueMaterial
  answer: GradingQueueAnswer
  onClose: () => void
  onSaved: () => void
}) {
  const [isCorrect, setIsCorrect] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await reviewAnswer(answer.answer_id, { is_correct: isCorrect, ai_feedback: feedback })
      onSaved()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-md bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-base font-semibold text-slate-800">回答を採点 — {answer.user_name}</span>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>
        <div className="mb-3">
          <div className="mb-1 text-xs font-semibold text-slate-500">教材／設問</div>
          <div className="text-[13px] text-slate-600">
            {material.material_title} ／ {answer.node_path} ／「{answer.prompt}」
          </div>
        </div>
        <div className="mb-3">
          <div className="mb-1 text-xs font-semibold text-slate-500">回答内容</div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] leading-relaxed">
            {answer.response_excerpt}
          </div>
        </div>
        <div className="mb-3.5">
          <div className="mb-1 text-xs font-semibold text-slate-500">正誤判定</div>
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input type="radio" checked={isCorrect} onChange={() => setIsCorrect(true)} />
              正解
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={!isCorrect} onChange={() => setIsCorrect(false)} />
              不正解
            </label>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">講評（受講者に表示されます）</label>
          <TextArea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            placeholder="受講者へのフィードバックを入力してください"
            className="w-full"
          />
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '採点結果を保存（次の未採点へ）'}
          </Button>
        </div>
      </div>
    </div>
  )
}
