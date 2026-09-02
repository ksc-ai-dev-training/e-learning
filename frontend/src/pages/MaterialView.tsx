import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import MyLearningToggle from '../components/ui/MyLearningToggle'
import SurveyModal from '../components/material/SurveyModal'
import { useMaterial } from '../hooks/useMaterial'
import { useMaterialAttachments } from '../hooks/useMaterialAttachments'
import { useAttemptSummary } from '../hooks/useAttemptSummary'
import { usePracticeAttempts } from '../hooks/usePracticeAttempts'
import { useSurveys } from '../hooks/useSurveys'
import { formatDateJst, formatDateTimeJst, formatDurationMinutes } from '../lib/datetime'
import { openAttachmentDownload } from '../lib/attachmentActions'
import { pageKindLabel, toEditableChapters } from '../lib/materialTree'
import { flattenPages, type FlatPage } from '../lib/pageNav'
import { startAttempt, startWrongQuestionsAttempt } from '../lib/attemptActions'
import { andFromQuery, backTarget, fromQuery } from '../lib/backLink'
import { ApiError } from '../lib/api'
import type { EditableNode } from '../lib/materialSource'
import type { QuizAttempt, Survey } from '../types'

const TABS = [
  { key: 'toc', label: '目次' },
  { key: 'practice', label: '反復演習' },
  { key: 'wrong_only', label: '誤答のみ抽出' },
] as const
type TabKey = (typeof TABS)[number]['key']

// S-04 教材受講：目次（詳細設計書10.4節）。
export default function MaterialView() {
  const { materialId } = useParams<{ materialId: string }>()
  const id = Number(materialId)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const from = searchParams.get('from')
  const back = backTarget(from)
  const returnQuery = fromQuery(from)
  const { material, error, isLoading, mutate: mutateMaterial } = useMaterial(id)
  const { attachments } = useMaterialAttachments(id)
  const [activeTab, setActiveTab] = useState<TabKey>('toc')
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const { items: attemptSummary } = useAttemptSummary(activeTab === 'toc' ? id : null)
  const { items: practiceAttempts } = usePracticeAttempts(activeTab === 'practice' ? id : null)
  const { surveys } = useSurveys(activeTab === 'toc' ? id : null)
  const [dismissedSurveyIds, setDismissedSurveyIds] = useState<Set<number>>(new Set())
  const [surveyModalSurvey, setSurveyModalSurvey] = useState<Survey | null>(null)

  const [wrongScope, setWrongScope] = useState<'material' | 'all'>('material')
  const [startingPractice, setStartingPractice] = useState(false)
  const [startingWrongOnly, setStartingWrongOnly] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (error || !material) {
    const message =
      error instanceof ApiError && error.status === 403
        ? 'この教材は受講対象ではありません。'
        : '教材を取得できませんでした。'
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="教材受講" />
        <div className="px-8 py-6">
          <Link to={back.to} className="text-blue-800 hover:underline">
            {back.label}
          </Link>
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
        </div>
      </div>
    )
  }

  const chapters = toEditableChapters(material.toc ?? [])
  const totalPages = material.page_count ?? 0
  const completedIds = new Set(material.progress?.completed_node_ids ?? [])
  const flatPages = flattenPages(material.toc ?? [])
  const currentNodeId = material.progress?.current_node_id ?? null

  // 上部の「ページX/Y」・進捗バーは、提出済み（completedIds）だけでなく現在の再開位置
  // （current_node_id）までの到達済みページも含めた「到達数」で表示する。目次ツリー各行の
  // ✓マーク・章ごとの「N/M 完了」は引き続きcompletedIds（実際に提出済み）のみで判定し、
  // 読んだだけでまだ提出していないページに誤って「完了」マークが付かないようにする
  // （2026-09-02、「続きから」は動くのに目次のページ数が0/5のままというフィードバックを受け追加）。
  const reachedIds = new Set(completedIds)
  if (currentNodeId !== null) {
    const currentIndex = flatPages.findIndex((p) => p.node.id === currentNodeId)
    for (let i = 0; i <= currentIndex; i++) reachedIds.add(flatPages[i].node.id)
  }
  const reachedCount = chapters.reduce((sum, chapter) => sum + countCompletedPages(chapter.children, reachedIds), 0)
  const progressPct = totalPages > 0 ? Math.round((reachedCount / totalPages) * 100) : 0
  const wholeMaterialAttachments = attachments.filter((a) => a.node_id === null)

  const resumeTargetNodeId = currentNodeId ?? flatPages[0]?.node.id ?? null
  const resumeLabel = !material.progress || material.progress.status === 'not_started' ? '受講を開始' : '続きから受講'

  const download = async (attachmentId: number) => {
    setDownloadError(null)
    try {
      await openAttachmentDownload(id, attachmentId)
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : 'ダウンロードに失敗しました')
    }
  }

  // AI採点結果パネル: attemptSummaryの各スコープの記述式・コード記述式の回答を横断集約する
  const aiGradedAnswers = attemptSummary.flatMap((entry) =>
    entry.answers.map((a) => ({ ...a, scope_label: entry.scope_label })),
  )

  // 受験後アンケートcallout: 合格済みスコープに設置された、まだ答えていない（または毎回表示の）
  // アンケートを1件だけ表示する（スキップはローカル状態のみ、次回訪問時にはまた表示される）
  const passedScopeIds = new Set(
    attemptSummary.filter((e) => e.attempt.passed === true).map((e) => e.scope_node_id),
  )
  const pendingSurvey = surveys.find(
    (s) =>
      passedScopeIds.has(s.node_id) &&
      s.is_active &&
      !dismissedSurveyIds.has(s.id) &&
      (s.repeat_mode === 'every_time' || !s.answered_by_me),
  )

  const handleStartPractice = async () => {
    setStartingPractice(true)
    setActionError(null)
    try {
      await startAttempt(id, { mode: 'practice' })
      const first = flatPages[0]
      if (first) navigate(`/materials/${id}/pages/${first.node.id}?mode=practice${andFromQuery(from)}`)
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '開始に失敗しました')
    } finally {
      setStartingPractice(false)
    }
  }

  const firstPageIdFor = (attempt: QuizAttempt, ownFlatPages: FlatPage[]): number => {
    const keys = Object.keys(attempt.question_order).map(Number)
    const matching = ownFlatPages.find((p) => keys.includes(p.node.id))
    return matching ? matching.node.id : keys[0]
  }

  const handleStartWrongOnly = async () => {
    setStartingWrongOnly(true)
    setActionError(null)
    try {
      const res = await startWrongQuestionsAttempt(id, wrongScope)
      const [firstAttempt, ...rest] = res.attempts
      if (rest.length > 0) {
        sessionStorage.setItem(
          'wrongOnlyQueue',
          JSON.stringify({
            queue: rest.map((a) => ({ materialId: a.material_id, attemptId: a.id })),
            returnTo: `/materials/${id}${returnQuery}`,
          }),
        )
      } else {
        sessionStorage.removeItem('wrongOnlyQueue')
      }
      const firstNodeId =
        firstAttempt.material_id === id
          ? firstPageIdFor(firstAttempt, flatPages)
          : firstPageIdFor(firstAttempt, [])
      navigate(
        `/materials/${firstAttempt.material_id}/pages/${firstNodeId}?mode=wrong_only&attemptId=${firstAttempt.id}${andFromQuery(from)}`,
      )
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : '開始に失敗しました')
    } finally {
      setStartingWrongOnly(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={material.title}
        actions={
          <>
            {material.is_company_wide && !material.required && (
              <MyLearningToggle
                materialId={id}
                registered={material.registered ?? false}
                onToggled={() => mutateMaterial()}
              />
            )}
            <Link
              to={back.to}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {back.label}
            </Link>
          </>
        }
      />
      <div className="px-8 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
          <Badge variant={material.required ? 'required' : 'optional'} />
          <span>
            全{chapters.length}章・{totalPages}ページ
          </span>
          {material.due_at && <span>／ 期限: {formatDateJst(material.due_at)}</span>}
        </div>

        <div className="mb-5 flex gap-1 border-b border-slate-200" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                activeTab === tab.key
                  ? 'border-blue-800 text-blue-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'toc' && (
          <>
            {totalPages > 0 && (
              <div className="mb-5 flex items-center gap-3">
                <span className="text-xs text-slate-500">
                  ページ {reachedCount}/{totalPages}
                </span>
                <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-blue-700" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="text-xs text-slate-500">{progressPct}%</span>
              </div>
            )}

            {downloadError && (
              <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {downloadError}
              </p>
            )}

            {pendingSurvey && (
              <div className="mb-5 rounded-md border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-900">{pendingSurvey.title}にご協力ください（任意・30秒程度）</p>
                <div className="mt-2 flex items-center gap-3">
                  <Button onClick={() => setSurveyModalSurvey(pendingSurvey)}>回答する</Button>
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:underline"
                    onClick={() => setDismissedSurveyIds((prev) => new Set(prev).add(pendingSurvey.id))}
                  >
                    今回はスキップ
                  </button>
                </div>
              </div>
            )}

            {attemptSummary.map((entry) => (
              <section
                key={entry.scope_node_id ?? 'material'}
                className={`mb-4 rounded-md border overflow-hidden ${entry.attempt.passed === false ? 'border-red-200' : 'border-slate-200'}`}
              >
                <div
                  className={`flex items-center justify-between px-4 py-2.5 ${entry.attempt.passed === false ? 'bg-red-50' : 'bg-slate-50'}`}
                >
                  <span className="text-sm font-semibold text-slate-700">{entry.scope_label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      entry.attempt.passed === true
                        ? 'bg-green-100 text-green-700'
                        : entry.attempt.passed === false
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {entry.attempt.passed === true ? '合格' : entry.attempt.passed === false ? '不合格' : '提出済み'}
                  </span>
                </div>
                <div className="px-4 py-3 text-xs text-slate-500">
                  {formatDateTimeJst(entry.attempt.submitted_at)} 実施 ／ 正答率
                  {entry.attempt.score_pct !== null ? Math.round(entry.attempt.score_pct) : '—'}%
                  {entry.attempt.passed === false && (
                    <p className="mt-1 text-red-700">
                      {entry.attempt.fail_reason
                        ? `⚠ ドボン設問「${entry.attempt.fail_reason}」に正解しなかったため不合格と判定されました。`
                        : '合格基準に届きませんでした。'}
                      {entry.retake_allowed &&
                      (entry.retake_limit === null || entry.attempt_count < entry.retake_limit)
                        ? ` 再受験可能（${entry.retake_limit !== null ? `残り${entry.retake_limit - entry.attempt_count}回` : '無制限'}）です。`
                        : ' 再受験はできません。'}
                    </p>
                  )}
                </div>
              </section>
            ))}

            {aiGradedAnswers.length > 0 && (
              <section className="mb-5 rounded-md border border-slate-200">
                <div className="border-b border-slate-200 px-4 py-2.5">
                  <span className="text-sm font-semibold text-slate-700">記述式回答のAI採点結果</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {aiGradedAnswers.map((a) => (
                    <div key={a.question_id} className="flex items-start gap-3 p-4">
                      <span
                        className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          a.ai_score_pct !== null ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {a.ai_score_pct !== null ? `${Math.round(a.ai_score_pct)}点` : '採点中'}
                      </span>
                      <div>
                        <div className="text-[12.5px] font-semibold text-slate-700">
                          {a.scope_label} {a.prompt}
                        </div>
                        {a.ai_feedback && <div className="mt-0.5 text-xs text-slate-500">{a.ai_feedback}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {wholeMaterialAttachments.length > 0 && (
              <section className="mb-5 rounded-md border border-slate-200">
                <div className="border-b border-slate-200 px-4 py-2.5">
                  <span className="text-sm font-semibold text-slate-700">教材全体の資料</span>
                </div>
                <div className="flex flex-wrap gap-4 p-4 text-sm">
                  {wholeMaterialAttachments.map((a) =>
                    a.kind === 'link' ? (
                      <a
                        key={a.id}
                        href={a.external_url ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 hover:underline"
                      >
                        {a.filename}
                      </a>
                    ) : (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => download(a.id)}
                        className="text-blue-700 hover:underline"
                      >
                        {a.filename}
                      </button>
                    ),
                  )}
                </div>
              </section>
            )}

            {chapters.length === 0 && (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                目次がまだ登録されていません。
              </p>
            )}

            {chapters.map((chapter, chapterIndex) => (
              <div key={chapter.id} className="mb-4 rounded-md border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <span className="text-sm font-semibold text-slate-700">
                    第{chapterIndex + 1}章 {chapter.title}
                  </span>
                  <span className="text-xs text-slate-400">
                    {countCompletedPages(chapter.children, completedIds)}/{countPages(chapter.children)} 完了
                  </span>
                </div>
                <div className="p-2">
                  {chapter.children.map((child) =>
                    child.kind === 'section' ? (
                      <div key={child.id} className="ml-2 mb-1.5">
                        <div className="flex items-center gap-2 px-2 py-1">
                          <span className="text-xs font-semibold text-slate-700">{child.title}</span>
                          <span className="flex-shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                            小見出し
                          </span>
                        </div>
                        <div className="ml-4 border-l-2 border-slate-200 pl-2">
                          {child.children.map((page) => (
                            <TocPageRow
                              key={page.id}
                              materialId={id}
                              nodeId={page.id}
                              title={page.title}
                              kindLabel={pageKindLabel(page)}
                              done={page.id !== null && completedIds.has(page.id)}
                              isCurrent={page.id !== null && page.id === currentNodeId}
                              query={returnQuery}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <TocPageRow
                        key={child.id}
                        materialId={id}
                        nodeId={child.id}
                        title={child.title}
                        kindLabel={pageKindLabel(child)}
                        done={child.id !== null && completedIds.has(child.id)}
                        isCurrent={child.id !== null && child.id === currentNodeId}
                        query={returnQuery}
                      />
                    ),
                  )}
                </div>
              </div>
            ))}

            {chapters.length > 0 && (
              <div className="mt-6 flex items-center gap-3 border-t border-slate-200 pt-5">
                <Link
                  to={back.to}
                  className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  一時中断する
                </Link>
                {resumeTargetNodeId !== null && (
                  <Link
                    to={`/materials/${id}/pages/${resumeTargetNodeId}${returnQuery}`}
                    className="rounded-md bg-blue-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    {resumeLabel}
                  </Link>
                )}
                <span className="text-xs text-slate-400">
                  中断しても回答内容は保存され、次回この続きから再開できます
                </span>
              </div>
            )}
          </>
        )}

        {activeTab === 'practice' && (
          <>
            <p className="mb-4 text-xs text-slate-500">
              合否判定を伴う受験とは別に、この教材の全ページの問題を回数制限なく繰り返し解けます。結果は合否には影響せず、習熟のための記録としてのみ残ります。
            </p>
            <section className="mb-5 rounded-md border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                <span className="text-sm font-semibold text-slate-700">これまでの実施履歴</span>
                <span className="text-xs text-slate-400">{practiceAttempts.length}回実施</span>
              </div>
              {practiceAttempts.length === 0 ? (
                <p className="p-4 text-center text-sm text-slate-400">まだ実施していません。</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-400">
                      <th className="px-4 py-2 text-left font-normal">実施日時</th>
                      <th className="px-4 py-2 text-right font-normal">正答数</th>
                      <th className="px-4 py-2 text-right font-normal">所要時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {practiceAttempts.map((p) => (
                      <tr key={p.id} className="border-b border-slate-50">
                        <td className="px-4 py-2">{formatDateTimeJst(p.submitted_at)}</td>
                        <td className="px-4 py-2 text-right">
                          {p.correct_count} / {p.total_count}
                        </td>
                        <td className="px-4 py-2 text-right">{formatDurationMinutes(p.duration_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}
            <Button onClick={handleStartPractice} disabled={startingPractice}>
              {startingPractice ? '開始中…' : '反復演習を開始'}
            </Button>
          </>
        )}

        {activeTab === 'wrong_only' && (
          <>
            <p className="mb-4 text-xs text-slate-500">
              過去に間違えた問題、または正答率の低い問題だけを抽出して出題します。結果は反復演習と同様に合否へは影響しません。
            </p>
            <div className="mb-4 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="wrong-scope"
                  checked={wrongScope === 'material'}
                  onChange={() => setWrongScope('material')}
                />
                この教材内の誤答のみ
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="wrong-scope"
                  checked={wrongScope === 'all'}
                  onChange={() => setWrongScope('all')}
                />
                全教材の誤答から出題
              </label>
              <p className="text-xs text-slate-400">正答率が低い設問（正答率50%未満）も合わせて抽出対象になります。</p>
            </div>
            {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}
            <Button onClick={handleStartWrongOnly} disabled={startingWrongOnly}>
              {startingWrongOnly ? '開始中…' : '誤答問題を解く'}
            </Button>
          </>
        )}
      </div>

      {surveyModalSurvey && (
        <SurveyModal
          survey={surveyModalSurvey}
          onClose={() => setSurveyModalSurvey(null)}
          onSubmitted={() => {
            setDismissedSurveyIds((prev) => new Set(prev).add(surveyModalSurvey.id))
            setSurveyModalSurvey(null)
          }}
        />
      )}
    </div>
  )
}

function countPages(nodes: EditableNode[]): number {
  let total = 0
  for (const n of nodes) {
    if (n.kind === 'page') total += 1
    total += countPages(n.children)
  }
  return total
}

function countCompletedPages(nodes: EditableNode[], completedIds: Set<number>): number {
  let total = 0
  for (const n of nodes) {
    if (n.kind === 'page' && n.id !== null && completedIds.has(n.id)) total += 1
    total += countCompletedPages(n.children, completedIds)
  }
  return total
}

function TocPageRow({
  materialId,
  nodeId,
  title,
  kindLabel,
  done,
  isCurrent = false,
  query = '',
}: {
  materialId: number
  nodeId: number | null
  title: string
  kindLabel: string
  done: boolean
  isCurrent?: boolean
  query?: string
}) {
  if (nodeId === null) {
    return (
      <div className="ml-2 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-slate-400">
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-slate-300 text-transparent">·</span>
        <span className="flex-1">{title}</span>
        <span className="flex-shrink-0 text-[10.5px] text-slate-400">{kindLabel}</span>
      </div>
    )
  }
  const circleClass = done
    ? 'bg-green-100 text-green-700'
    : isCurrent
      ? 'bg-blue-600 text-white'
      : 'border border-slate-300 text-transparent'
  return (
    <Link
      to={`/materials/${materialId}/pages/${nodeId}${query}`}
      className="ml-2 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-slate-500 hover:bg-blue-50"
    >
      <span
        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] ${circleClass}`}
        title={isCurrent ? '続きはここから' : undefined}
      >
        {done ? '✓' : isCurrent ? '●' : '·'}
      </span>
      <span className="flex-1 text-slate-700">{title}</span>
      <span className="flex-shrink-0 text-[10.5px] text-slate-400">{kindLabel}</span>
    </Link>
  )
}
