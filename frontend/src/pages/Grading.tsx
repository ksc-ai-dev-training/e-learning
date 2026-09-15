import { useMemo, useState } from 'react'
import PageHeader from '../components/layout/PageHeader'
import Panel from '../components/ui/Panel'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import TextArea from '../components/ui/TextArea'
import { useMe } from '../hooks/useMe'
import { useProjects } from '../hooks/useProjects'
import { useGradingQueue } from '../hooks/useGradingQueue'
import { useAttemptGrading } from '../hooks/useAttemptGrading'
import { saveDraftReview, finalizeAttemptGrading } from '../lib/gradingActions'
import { formatDateJst, formatDateTimeJst } from '../lib/datetime'
import { ApiError } from '../lib/api'
import type { GradingQueueAttempt, GradingQueueMaterial } from '../types'

// S-20 採点（未採点キュー）。記述式・コード記述式のうち採点方式が「プロジェクト担当者が手動採点」で
// まだ採点していない回答だけを、教材ごと・さらに受験記録（教材×受講者×提出日）ごとにまとめて
// カード表示する。1問ずつではなく受験記録単位でまとめて採点したいというユーザー要望により、
// 以前の「教材の中に回答が1件ずつフラットに並ぶ」形式から変更した（2026-09-15）。
// 設問の傾向を見直す場合はS-05「問題一覧」タブ→S-19（設問別の回答・結果一覧）を使う。
export default function Grading() {
  const { me } = useMe()
  const [scopeAll, setScopeAll] = useState(false)
  const { projects } = useProjects('editor')
  const [projectId, setProjectId] = useState<number | null>(null)
  const { data, isLoading, mutate } = useGradingQueue(scopeAll, projectId)
  const [materialFilter, setMaterialFilter] = useState('')
  const [target, setTarget] = useState<{ material: GradingQueueMaterial; attempt: GradingQueueAttempt } | null>(null)

  const materials = useMemo(() => data?.materials ?? [], [data])

  const projectOptions = useMemo(
    () => [{ value: '', label: 'すべて' }, ...projects.map((p) => ({ value: String(p.id), label: p.name }))],
    [projects],
  )

  const materialOptions = useMemo(
    () => [
      { value: '', label: 'すべての教材' },
      ...materials.map((m) => ({ value: String(m.material_id), label: m.material_title })),
    ],
    [materials],
  )

  const visibleMaterials = materials.filter((m) => !materialFilter || String(m.material_id) === materialFilter)
  const totalPending = visibleMaterials.reduce((sum, m) => sum + m.pending_count, 0)
  const totalAttempts = visibleMaterials.reduce((sum, m) => sum + m.attempts.length, 0)
  const oldestSubmittedAt = visibleMaterials
    .flatMap((m) => m.attempts.map((a) => a.submitted_at))
    .sort()[0]

  const handleFinalized = async () => {
    setTarget(null)
    await mutate()
  }

  return (
    <div>
      <PageHeader title="採点" />
      <div className="px-8 py-6">
        <p className="mb-4 max-w-3xl text-sm text-slate-500">
          記述式・コード記述式の設問のうち<strong>採点方式が「プロジェクト担当者が手動採点」で、まだ採点していない回答</strong>
          を、教材ごと・受験記録（受講者・提出日）ごとにまとめて表示します。カードを開くとその受験記録内の未採点設問がまとめて採点でき、
          <strong>すべての設問を採点して「採点結果を送信」するまで受講者には一切表示されません</strong>
          。途中まで採点した内容は下書きとして保存され、次にカードを開いたときに引き継がれます。設問の傾向を見て内容を見直したい場合はS-05「問題一覧」タブ→S-19（設問別の回答・結果一覧）を使ってください。
        </p>

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">プロジェクトで絞り込み</label>
            <Select
              value={projectId === null ? '' : String(projectId)}
              onChange={(v) => {
                setProjectId(v === '' ? null : Number(v))
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
          <StatTile label="対象の受験記録" value={`${totalAttempts}件`} />
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
            <Panel key={m.material_id} title={m.material_title} count={`${m.project_name} ／ 未採点${m.pending_count}件`}>
              <div className="flex flex-col divide-y divide-slate-100">
                {m.attempts.map((a) => (
                  <button
                    key={a.attempt_id}
                    type="button"
                    onClick={() => setTarget({ material: m, attempt: a })}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{a.user_name}</div>
                      <div className="text-[11.5px] text-slate-400">提出日: {formatDateJst(a.submitted_at)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {a.draft_count > 0 && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                          下書き{a.draft_count}/{a.total_count}件
                        </span>
                      )}
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        採点待ち{a.total_count}問
                      </span>
                      <span className="text-slate-300">›</span>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>
          ))
        )}
      </div>

      {target && (
        <AttemptGradingModal
          material={target.material}
          attempt={target.attempt}
          onClose={() => setTarget(null)}
          onFinalized={handleFinalized}
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

// 受験記録1件分の採点待ち設問をまとめて表示・採点するモーダル（S-20カードを開いたとき）。
// 各設問は「仮保存」で下書き（draft_is_correct/draft_ai_feedback）として保存されるだけで
// 受講者には見えない。全設問が仮保存済みになって初めて「採点結果を送信」が押せるようになり、
// 押すとまとめて本採用され受講者に公開される。
function AttemptGradingModal({
  material,
  attempt,
  onClose,
  onFinalized,
}: {
  material: GradingQueueMaterial
  attempt: GradingQueueAttempt
  onClose: () => void
  onFinalized: () => void
}) {
  const { data, isLoading } = useAttemptGrading(attempt.attempt_id)
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set())
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)

  // サーバーから返ってきた下書き済みの設問は、初回表示時点で既に「仮保存済み」として扱う
  // （前回途中まで採点していた分の引き継ぎ）。data?.itemsは`?? []`で毎回新しい配列参照になるため、
  // 依存配列にはdata自体を入れる（items変数を入れるとuseMemoが常に再計算されてしまう）。
  const items = useMemo(() => data?.items ?? [], [data])
  const initiallySaved = useMemo(
    () => new Set(items.filter((i) => i.draft_is_correct !== null).map((i) => i.answer_id)),
    [items],
  )
  const savedCount = items.filter((i) => savedIds.has(i.answer_id) || initiallySaved.has(i.answer_id)).length
  const allSaved = items.length > 0 && savedCount === items.length

  const handleFinalize = async () => {
    setFinalizing(true)
    setFinalizeError(null)
    try {
      await finalizeAttemptGrading(attempt.attempt_id)
      onFinalized()
    } catch (e) {
      setFinalizeError(e instanceof ApiError ? e.message : '送信に失敗しました')
    } finally {
      setFinalizing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-md bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <div className="text-base font-semibold text-slate-800">
              {material.material_title} — {attempt.user_name}
            </div>
            <div className="text-[11.5px] text-slate-400">
              提出日: {formatDateTimeJst(attempt.submitted_at)}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <p className="text-sm text-slate-400">読み込み中...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400">採点待ちの設問はありません（既に他の担当者が採点した可能性があります）。</p>
          ) : (
            <div className="flex flex-col gap-4">
              {items.map((item) => (
                <QuestionGradingCard
                  key={item.answer_id}
                  item={item}
                  saved={savedIds.has(item.answer_id) || initiallySaved.has(item.answer_id)}
                  onSaved={() => setSavedIds((prev) => new Set(prev).add(item.answer_id))}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-5 py-3.5">
          {finalizeError && <p className="mb-2 text-xs text-red-600">{finalizeError}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {savedCount}/{items.length}問 仮保存済み
              {!allSaved && '（すべて仮保存すると送信できます）'}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={finalizing}>
                閉じる（続きは後で）
              </Button>
              <Button onClick={handleFinalize} disabled={!allSaved || finalizing}>
                {finalizing ? '送信中…' : '採点結果を送信'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuestionGradingCard({
  item,
  saved,
  onSaved,
}: {
  item: {
    answer_id: number
    node_path: string
    prompt: string
    scoring_criteria: string | null
    response: unknown
    draft_is_correct: boolean | null
    draft_ai_feedback: string | null
  }
  saved: boolean
  onSaved: () => void
}) {
  const [isCorrect, setIsCorrect] = useState<boolean | null>(item.draft_is_correct)
  const [feedback, setFeedback] = useState(item.draft_ai_feedback ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (isCorrect === null) return
    setSaving(true)
    setError(null)
    try {
      await saveDraftReview(item.answer_id, { is_correct: isCorrect, ai_feedback: feedback })
      onSaved()
    } catch {
      setError('仮保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const responseText = Array.isArray(item.response) ? item.response.join('、') : String(item.response ?? '（未回答）')

  return (
    <div className={`rounded-md border p-3.5 ${saved ? 'border-slate-200' : 'border-blue-300 ring-1 ring-blue-100'}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] text-slate-400">
          {item.node_path} ／ 設問「{item.prompt}」
        </span>
        {saved && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">仮保存済み</span>
        )}
      </div>
      {item.scoring_criteria && (
        <div className="mb-2 text-[11.5px] text-slate-400">採点基準: {item.scoring_criteria}</div>
      )}
      <div className="mb-2.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] leading-relaxed">
        {responseText}
      </div>
      <div className="mb-2 flex items-center gap-4">
        <span className="text-xs font-semibold text-slate-500">正誤判定</span>
        <label className="flex items-center gap-1 text-xs">
          <input type="radio" checked={isCorrect === true} onChange={() => setIsCorrect(true)} />
          正解
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input type="radio" checked={isCorrect === false} onChange={() => setIsCorrect(false)} />
          不正解
        </label>
      </div>
      <TextArea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={2}
        placeholder="受講者へのフィードバックを入力してください（結果送信後に表示されます）"
        className="mb-2 w-full"
      />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <Button variant="secondary" className="h-8 px-2.5 text-xs" onClick={handleSave} disabled={isCorrect === null || saving}>
        {saving ? '保存中…' : 'この設問を仮保存'}
      </Button>
    </div>
  )
}
