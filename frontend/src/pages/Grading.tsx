import { useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '../components/layout/PageHeader'
import Panel from '../components/ui/Panel'
import Select from '../components/ui/Select'
import Button from '../components/ui/Button'
import TextArea from '../components/ui/TextArea'
import { useProjects } from '../hooks/useProjects'
import { useGradingQueue } from '../hooks/useGradingQueue'
import { useAttemptGrading } from '../hooks/useAttemptGrading'
import { saveDraftReview, finalizeAttemptGrading } from '../lib/gradingActions'
import { formatDateJst, formatDateTimeJst } from '../lib/datetime'
import { ApiError } from '../lib/api'
import type { GradingQueueAttempt, GradingQueueMaterial } from '../types'

// S-20 採点（未採点キュー）。記述式・コード記述式のうち採点方式が「手動採点」で、まだ採点していない
// 回答だけを、教材ごと・さらに受験記録（教材×受講者×提出日）ごとにまとめてカード表示する。
// 1問ずつではなく受験記録単位でまとめて採点したいというユーザー要望により、以前の「教材の中に
// 回答が1件ずつフラットに並ぶ」形式から変更した（2026-09-15）。
// 採点できるのは教材の作成者のみ（2026-09-17、プロジェクト編集者なら誰でも採点できる仕様だと、
// 全社員がeditorになる全社ライブラリで誰でもお互いの回答を見られてしまう穴があったため変更した）。
// 設問の傾向を見直す場合はS-05「問題一覧」タブ→S-19（設問別の回答・結果一覧）を使う。
export default function Grading() {
  const { projects } = useProjects('editor')
  const [projectId, setProjectId] = useState<number | null>(null)
  const { data, isLoading, mutate } = useGradingQueue(projectId)
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
          記述式・コード記述式の設問のうち<strong>採点方式が「手動採点」で、まだ採点していない回答</strong>
          を、教材ごと・受験記録（受講者・提出日）ごとにまとめて表示します（<strong>採点できるのは教材の作成者のみ</strong>です）。カードを開くとその受験記録内の未採点設問がまとめて採点でき、
          正誤判定・フィードバックは入力するたびに自動保存されるため、次にカードを開いたときに引き継がれます。
          <strong>必須設問をすべて採点して「採点結果を送信」するまで受講者には一切表示されません</strong>
          （任意設問は未採点のまま送信することもできます）。設問の傾向を見て内容を見直したい場合は「教材作成・編集」から該当教材を選択し「問題一覧」タブを使ってください。
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
// 各設問の正誤判定・フィードバックは入力するたびに自動保存され（draft_is_correct/draft_ai_feedback）、
// 受講者にはまだ見えない。必須設問がすべて判定済みになると「採点結果を送信」が押せるようになり、
// 押すとその時点で判定済みの設問（必須＋判定済みの任意）がまとめて本採用され受講者に公開される
// （2026-09-16、明示的な「仮保存」ボタンを廃止し自動保存化。あわせて送信条件を必須設問のみに緩和）。
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
  // 各設問の「現在の」正誤判定値。子カードが変更するたびにここへ即時反映し、送信ボタンの
  // 必須/任意判定に使う。
  const [liveJudgments, setLiveJudgments] = useState<Record<number, boolean | null>>({})
  // 保存が失敗したまま残っているカードがないか（answer_idごと）。2026-09-16、再レビューで発見:
  // 正誤判定はクリックした時点で楽観的にliveJudgmentsへ反映するため、通信エラーで実際には
  // サーバーに保存されていなくても「採点済み」として送信できてしまい、バックエンド側の検証で
  // 初めて（かつ理由が伝わりにくい形で）拒否される問題があった。保存に失敗したカードが1件でも
  // 残っている間は送信自体をブロックし、どのカードが失敗しているかは各カードの表示に任せる。
  const [saveErrors, setSaveErrors] = useState<Record<number, boolean>>({})
  const hasSaveError = Object.values(saveErrors).some(Boolean)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<'blocked' | 'confirm-optional' | null>(null)
  // 各カードのデバウンス中フィードバック保存を即時実行するための関数を、カード側からここへ登録して
  // もらう（answer_idごと）。送信・閉じるの直前に全カード分をまとめて呼び、入力後すぐに送信/離脱
  // した場合でもデバウンス待ちの内容を消さずに済むようにする（2026-09-16、実装後レビューで発見:
  // useEffectのクリーンアップがタイマーをclearTimeoutするだけでpersistを呼んでおらず、
  // 入力から700ms以内にモーダルを閉じる／送信すると直前の入力が保存されずに失われていた）。
  const flushFnsRef = useRef<Map<number, () => Promise<void>>>(new Map())
  const flushAllPending = async () => {
    await Promise.all(Array.from(flushFnsRef.current.values()).map((fn) => fn()))
  }

  // data?.itemsは`?? []`で毎回新しい配列参照になるため、依存配列にはdata自体を入れる
  // （items変数を入れるとuseMemoが常に再計算されてしまう）。
  const items = useMemo(() => data?.items ?? [], [data])
  const initialJudgments = useMemo(
    () => Object.fromEntries(items.map((i) => [i.answer_id, i.draft_is_correct])),
    [items],
  )
  const judgmentFor = (answerId: number): boolean | null =>
    answerId in liveJudgments ? liveJudgments[answerId] : (initialJudgments[answerId] ?? null)

  const judgedCount = items.filter((i) => judgmentFor(i.answer_id) !== null).length
  const requiredUnjudged = items.filter((i) => i.required && judgmentFor(i.answer_id) === null)
  const optionalUnjudged = items.filter((i) => !i.required && judgmentFor(i.answer_id) === null)
  // 全設問が任意で1問も採点していない場合、送信対象が0件になりバックエンドが400を返すだけで
  // 何も起きない（実装後レビューで発見: 「未採点のまま送信しますか？」の確認を挟んだ直後に
  // 理由の分かりにくいエラーが出るだけの遠回りな体験になっていた）。この場合は最初から送信不可にし、
  // 理由を明示する。
  const nothingJudgedYet = items.length > 0 && judgedCount === 0

  const runFinalize = async () => {
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

  const handleFinalizeClick = async () => {
    // 直前に入力したフィードバックがデバウンス待ちのまま残っていないか、送信前に必ず確定させる
    setFinalizing(true)
    await flushAllPending()
    setFinalizing(false)
    if (requiredUnjudged.length > 0) {
      setConfirmDialog('blocked')
      return
    }
    if (optionalUnjudged.length > 0) {
      setConfirmDialog('confirm-optional')
      return
    }
    void runFinalize()
  }

  const handleClose = () => {
    // 閉じる場合も同様に、デバウンス待ちのフィードバックを取りこぼさないよう送信しておく
    // （完了を待たずにモーダルは閉じてよい。次に開いたときには保存済みの内容が反映される）
    void flushAllPending()
    onClose()
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
          <button type="button" onClick={handleClose} className="text-slate-400 hover:text-slate-600">
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
                  onJudgeChange={(isCorrect) =>
                    setLiveJudgments((prev) => ({ ...prev, [item.answer_id]: isCorrect }))
                  }
                  onSaveErrorChange={(hasError) =>
                    setSaveErrors((prev) => ({ ...prev, [item.answer_id]: hasError }))
                  }
                  registerFlush={(fn) => {
                    flushFnsRef.current.set(item.answer_id, fn)
                    return () => flushFnsRef.current.delete(item.answer_id)
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-5 py-3.5">
          {finalizeError && <p className="mb-2 text-xs text-red-600">{finalizeError}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {judgedCount}/{items.length}問 採点済み
              {requiredUnjudged.length > 0 && '（必須設問が未採点のため送信できません）'}
              {requiredUnjudged.length === 0 && nothingJudgedYet && '（1問も採点していないため送信できません）'}
              {requiredUnjudged.length === 0 && !nothingJudgedYet && hasSaveError &&
                '（保存に失敗した設問があります。入力し直してから送信してください）'}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleClose} disabled={finalizing}>
                閉じる（続きは後で）
              </Button>
              <Button
                onClick={() => void handleFinalizeClick()}
                disabled={items.length === 0 || nothingJudgedYet || hasSaveError || finalizing}
              >
                {finalizing ? '送信中…' : '採点結果を送信'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {confirmDialog === 'blocked' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-md bg-white p-5 shadow-lg">
            <p className="mb-3 text-sm font-semibold text-slate-800">必須設問が未採点です</p>
            <p className="mb-4 text-xs text-slate-500">
              以下の必須設問の正誤判定が済んでいないため送信できません。すべて判定してから改めて送信してください。
            </p>
            <ul className="mb-4 list-disc pl-4 text-xs text-slate-600">
              {requiredUnjudged.map((i) => (
                <li key={i.answer_id}>{i.node_path} ／ 設問「{i.prompt}」</li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setConfirmDialog(null)}>
                閉じる
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog === 'confirm-optional' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-md bg-white p-5 shadow-lg">
            <p className="mb-3 text-sm font-semibold text-slate-800">
              {optionalUnjudged.length}問の任意設問が未採点です
            </p>
            <p className="mb-4 text-xs text-slate-500">
              未採点のまま送信すると、これらの設問はこのまま採点待ちとして残ります（後でこのカードを開いて改めて採点できます）。このまま送信しますか？
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmDialog(null)}>
                キャンセル
              </Button>
              <Button
                onClick={() => {
                  setConfirmDialog(null)
                  void runFinalize()
                }}
              >
                送信する
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 保存後に一定時間だけ「保存済み」を表示し、その後は何も表示しない（保存操作を継続的に主張しない）
const SAVED_INDICATOR_MS = 2000

function QuestionGradingCard({
  item,
  onJudgeChange,
  onSaveErrorChange,
  registerFlush,
}: {
  item: {
    answer_id: number
    node_path: string
    prompt: string
    scoring_criteria: string | null
    required: boolean
    response: unknown
    draft_is_correct: boolean | null
    draft_ai_feedback: string | null
  }
  onJudgeChange: (isCorrect: boolean | null) => void
  onSaveErrorChange: (hasError: boolean) => void
  registerFlush: (flush: () => Promise<void>) => () => void
}) {
  const [isCorrect, setIsCorrect] = useState<boolean | null>(item.draft_is_correct)
  const [feedback, setFeedback] = useState(item.draft_ai_feedback ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedIndicatorRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // アンマウント時・親からの一括flush時にも常に最新のisCorrect/feedbackを読めるようにするためのref
  // （useEffectのクリーンアップはマウント時点のクロージャのままなので、stateを直接参照すると古い値
  // を送ってしまう）。
  const latestRef = useRef({ isCorrect, feedback })
  latestRef.current = { isCorrect, feedback }

  const persist = async (nextIsCorrect: boolean | null, nextFeedback: string) => {
    setSaveState('saving')
    try {
      await saveDraftReview(item.answer_id, { is_correct: nextIsCorrect, ai_feedback: nextFeedback })
      setSaveState('saved')
      onSaveErrorChange(false)
      if (savedIndicatorRef.current) clearTimeout(savedIndicatorRef.current)
      savedIndicatorRef.current = setTimeout(() => setSaveState('idle'), SAVED_INDICATOR_MS)
    } catch {
      setSaveState('error')
      onSaveErrorChange(true)
    }
  }

  // デバウンス待ちのフィードバック保存を即座に実行する（送信・離脱の直前や、この設問の入力欄が
  // フォーカスを失ったときに呼ぶ）。2026-09-16、実装後レビューで発見: 以前はモーダルを閉じる／
  // 送信するタイミングでタイマーをclearTimeoutするだけでpersistを呼んでおらず、入力から700ms以内に
  // 離脱すると直前のフィードバック入力が保存されずに失われていた不具合の修正。
  const flushPending = async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
      await persist(latestRef.current.isCorrect, latestRef.current.feedback)
    }
  }

  useEffect(() => {
    const unregister = registerFlush(flushPending)
    return () => {
      unregister()
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        // アンマウント時は待てないため確定は待たずに投げる（fire-and-forget）。呼び出し元
        // （送信・閉じるボタン）は先にflushAllPendingを待ってからこのモーダルを閉じるため、
        // 通常この分岐に来るのは「保存前にブラウザ自体を閉じた」等の想定外の離脱時のみ。
        void persist(latestRef.current.isCorrect, latestRef.current.feedback)
      }
      if (savedIndicatorRef.current) clearTimeout(savedIndicatorRef.current)
      // このカードがエラー状態のまま消えても親のsaveErrorsに残り続け、以後ずっと送信不可のまま
      // になってしまうため、アンマウント時に必ずクリアする（2026-09-16、再レビューで発見）。
      onSaveErrorChange(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleJudgeChange = (value: boolean | null) => {
    setIsCorrect(value)
    onJudgeChange(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    void persist(value, feedback)
  }

  const scheduleFeedbackSave = (value: string) => {
    setFeedback(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void persist(isCorrect, value), 700)
  }

  const responseText = Array.isArray(item.response) ? item.response.join('、') : String(item.response ?? '（未回答）')

  return (
    <div className={`rounded-md border p-3.5 ${isCorrect !== null ? 'border-slate-200' : 'border-blue-300 ring-1 ring-blue-100'}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] text-slate-400">
          {item.node_path} ／ 設問「{item.prompt}」
          {!item.required && (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">任意</span>
          )}
        </span>
        <span className="text-[11px] font-semibold">
          {saveState === 'saving' && <span className="text-slate-400">保存中…</span>}
          {saveState === 'saved' && <span className="text-emerald-600">保存済み</span>}
          {saveState === 'error' && <span className="text-red-600">保存に失敗しました</span>}
        </span>
      </div>
      {item.scoring_criteria && (
        <div className="mb-2 text-[11.5px] text-slate-400">採点基準: {item.scoring_criteria}</div>
      )}
      <div className="mb-2.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] leading-relaxed">
        {responseText}
      </div>
      <div className="mb-2 flex items-center gap-4">
        <span className="text-xs font-semibold text-slate-500">正誤判定</span>
        {/* ネイティブのradioはクリックだけでは選択解除できないため、既に選択済みの方を
            もう一度クリックしたときはonClickで検知して未判定（null）に戻す（2026-09-16、
            ユーザー要望。誤って選んだ場合や判断を保留し直したい場合に使う）。onChangeは
            通常どおり別の選択肢へ切り替えたときのみ発火する。 */}
        <label className="flex items-center gap-1 text-xs">
          <input
            type="radio"
            checked={isCorrect === true}
            onChange={() => handleJudgeChange(true)}
            onClick={() => {
              if (isCorrect === true) handleJudgeChange(null)
            }}
          />
          正解
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="radio"
            checked={isCorrect === false}
            onChange={() => handleJudgeChange(false)}
            onClick={() => {
              if (isCorrect === false) handleJudgeChange(null)
            }}
          />
          不正解
        </label>
      </div>
      <TextArea
        value={feedback}
        onChange={(e) => scheduleFeedbackSave(e.target.value)}
        onBlur={() => void flushPending()}
        rows={2}
        placeholder="受講者へのフィードバックを入力してください（結果送信後に表示されます）"
        className="w-full"
      />
    </div>
  )
}
