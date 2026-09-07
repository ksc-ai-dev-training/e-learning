import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import StatCard from '../components/ui/StatCard'
import { useMe } from '../hooks/useMe'
import { usePersonalAiFeedback, usePersonalReport } from '../hooks/usePersonalReport'
import { ApiError } from '../lib/api'
import { fromPersonalReport } from '../lib/backLink'
import { formatDateJst, formatDateTimeJst } from '../lib/datetime'
import { resetMaterialProgress } from '../lib/materialActions'
import { requestPersonalAiFeedback } from '../lib/reportActions'
import { scrollToAndHighlight } from '../lib/scrollHighlight'
import type { EnrollmentStatus } from '../types'

const GENERATING_SLOW_AFTER_MS = 3 * 60 * 1000

// 学習履歴のタブ構成（2026-09-03、ユーザー提案）。「未受講」タブは対象を広げず、一度着手した
// 教材を「未受講に戻す」で戻したものだけを表示する（一度も着手していない教材はそもそも学習履歴に
// 出てこないため、このタブにも出てこない。マイ学習・教材一覧側の「未受講」とは対象範囲が異なる
// ことが伝わるよう、タブ名は単なる「未受講」ではなく「未受講に戻した教材」とした）。
const HISTORY_TABS: { key: EnrollmentStatus; label: string }[] = [
  { key: 'completed', label: '完了' },
  { key: 'in_progress', label: '受講中' },
  { key: 'not_started', label: '未受講に戻した教材' },
]

// S-09 個人学習レポート（詳細設計書4.7節 A-50〜A-52、10.8節）。本人、または対象者が所属する
// プロジェクトの管理者・システムadminが閲覧できる。AI個人フィードバック（F-22）は、開くたびに
// AI呼び出しの課金が発生するのを避けるため、設計書の「開いたら自動生成」ではなく「生成する」
// ボタンでの手動トリガーに変更した（2026-09-02、ユーザー判断）。
export default function PersonalReport() {
  const { userId: userIdParam } = useParams<{ userId: string }>()
  const { me } = useMe()
  const targetUserId = userIdParam === 'me' ? (me?.id ?? null) : Number(userIdParam)

  const { report, error, isLoading, mutate: mutateReport } = usePersonalReport(targetUserId)
  const [generating, setGenerating] = useState(false)
  const { feedback, mutate: mutateFeedback } = usePersonalAiFeedback(targetUserId, generating)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [slowWarning, setSlowWarning] = useState(false)
  const [confirmingResetId, setConfirmingResetId] = useState<number | null>(null)
  const [resettingId, setResettingId] = useState<number | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [historyTab, setHistoryTab] = useState<EnrollmentStatus>('completed')

  useEffect(() => {
    if (generating && feedback) setGenerating(false)
  }, [generating, feedback])

  useEffect(() => {
    if (!generating) {
      setSlowWarning(false)
      return
    }
    const timer = setTimeout(() => setSlowWarning(true), GENERATING_SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [generating])

  const handleGenerate = async () => {
    if (targetUserId == null) return
    setGenerateError(null)
    setSlowWarning(false)
    try {
      await requestPersonalAiFeedback(targetUserId)
      setGenerating(true)
      await mutateFeedback()
    } catch (e) {
      setGenerateError(e instanceof ApiError ? e.message : 'フィードバックの生成開始に失敗しました')
    }
  }

  const handleResetProgress = async (materialId: number) => {
    setResetError(null)
    setResettingId(materialId)
    try {
      await resetMaterialProgress(materialId)
      await mutateReport()
    } catch (e) {
      setResetError(e instanceof ApiError ? e.message : '進捗のリセットに失敗しました')
    } finally {
      setResettingId(null)
      setConfirmingResetId(null)
    }
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="個人学習レポート" />
        <div className="px-8 py-6">
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error instanceof ApiError ? error.message : 'レポートの取得に失敗しました。'}
          </p>
        </div>
      </div>
    )
  }

  if (!report) return null

  const isOwnReport = me?.id === report.target_user.id
  const historyByStatus: Record<EnrollmentStatus, typeof report.history> = {
    completed: report.history.filter((h) => h.status === 'completed'),
    in_progress: report.history.filter((h) => h.status === 'in_progress'),
    not_started: report.history.filter((h) => h.status === 'not_started'),
  }
  const visibleHistory = historyByStatus[historyTab]
  const scoredHistory = report.history
    .filter((h) => h.score_pct != null)
    .sort((a, b) => a.score_pct! - b.score_pct!)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={`個人学習レポート — ${report.target_user.name}`} />
      <div className="px-8 py-6">
        {report.target_user.project_names.length > 0 && (
          <p className="mb-4 text-xs text-slate-500">
            所属プロジェクト: {report.target_user.project_names.join('、')}
          </p>
        )}

        <div className="mb-6 grid max-w-3xl grid-cols-4 gap-3">
          <StatCard
            label="受講済み教材数"
            value={report.summary.completed_material_count}
            unit="件"
            onClick={() => {
              setHistoryTab('completed')
              scrollToAndHighlight('learning-history')
            }}
          />
          <StatCard
            label="未受講の必修教材"
            value={report.summary.incomplete_required_count}
            unit="件"
            tone="warn"
            linkTo={isOwnReport ? '/#required-materials' : undefined}
          />
          <StatCard
            label="必修受講完了率"
            value={report.summary.required_completion_pct}
            unit="%"
            detail={`${report.summary.completed_required_count}件／${report.summary.total_required_count}件`}
          />
          <StatCard
            label="直近の受講"
            value={report.summary.last_activity_at ? formatDateJst(report.summary.last_activity_at) : '—'}
          />
        </div>

        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-slate-700">AIによる個人フィードバック</h3>
          {feedback && <span className="text-xs text-slate-400">{formatDateTimeJst(feedback.generated_at)} 生成</span>}
        </div>
        <div className="mb-6 max-w-3xl rounded-md border border-slate-200 p-4">
          {scoredHistory.length > 0 && (
            <div className="mb-4 border-b border-slate-100 pb-4">
              <div className="mb-1.5 text-xs font-semibold text-slate-500">教材別正答率</div>
              <div className="space-y-1">
                {scoredHistory.map((h) => (
                  <div key={h.material_id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{h.material_title}</span>
                    <span className="font-semibold text-slate-800">{Math.round(h.score_pct!)}点</span>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                設問を含む受験記録がある教材のみ表示します（説明文のみのページは対象外）。
              </p>
            </div>
          )}
          {feedback ? (
            <>
              <p className="mb-3 text-sm leading-relaxed text-slate-700">{feedback.comment}</p>
              {feedback.weak_areas.length > 0 && (
                <div className="mb-2">
                  <span className="mr-1.5 text-xs text-slate-500">理解不足の可能性がある分野:</span>
                  {feedback.weak_areas.map((tag) => (
                    <span
                      key={tag}
                      className="mr-1 inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {feedback.recommended_materials.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold text-slate-500">おすすめ教材</div>
                  {feedback.recommended_materials.map((m) => (
                    <a
                      key={m.id}
                      href={`/materials/${m.id}`}
                      className="mb-1.5 block rounded-md border border-slate-200 px-3 py-2 text-sm text-blue-800 hover:bg-slate-50"
                    >
                      {m.title}
                    </a>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-400">
                このフィードバックは学習支援を目的としたものであり、人事評価には使用されません。
              </p>
            </>
          ) : generating ? (
            <div className="text-sm text-slate-500">
              作成中...
              {slowWarning && (
                <p className="mt-1 text-xs text-amber-600">
                  生成に時間がかかっています。しばらく経っても表示されない場合は再度お試しください。
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="mb-3 text-sm text-slate-500">
                まだAI個人フィードバックは生成されていません。学習傾向を分析してコメントを作成します（該当する教材があればおすすめ教材も表示します）。
              </p>
              <Button type="button" variant="secondary" onClick={handleGenerate}>
                生成する
              </Button>
              {generateError && <span className="ml-3 text-sm text-red-600">{generateError}</span>}
            </div>
          )}
        </div>

        <div id="learning-history" className="mb-2 flex scroll-mt-4 items-baseline justify-between">
          <h3 className="text-sm font-semibold text-slate-700">学習履歴</h3>
          {resetError && <span className="text-sm text-red-600">{resetError}</span>}
        </div>
        {report.history.length === 0 ? (
          <p className="text-sm text-slate-400">学習履歴はまだありません。</p>
        ) : (
          <>
            <div className="mb-3 flex gap-1 border-b border-slate-200" role="tablist">
              {HISTORY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={historyTab === tab.key}
                  onClick={() => setHistoryTab(tab.key)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-semibold ${
                    historyTab === tab.key
                      ? 'border-blue-800 text-blue-900'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab.label} ({historyByStatus[tab.key].length})
                </button>
              ))}
            </div>
            {visibleHistory.length === 0 ? (
              <p className="text-sm text-slate-400">該当する教材はありません。</p>
            ) : (
              <div className="max-w-3xl overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-3 py-2 font-normal">教材</th>
                      <th className="px-3 py-2 font-normal">受講日</th>
                      <th className="px-3 py-2 font-normal">結果</th>
                      <th className="px-3 py-2 text-right font-normal">スコア</th>
                      {isOwnReport && <th className="px-3 py-2 font-normal">操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHistory.map((h) => (
                      <tr key={h.material_id} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-2 text-slate-800">
                          <Link
                            to={`/materials/${h.material_id}?from=${fromPersonalReport(userIdParam ?? 'me')}`}
                            className="text-blue-800 hover:underline"
                          >
                            {h.material_title}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {h.completed_at ? formatDateJst(h.completed_at) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {h.status === 'completed' ? (
                            h.passed === true ? (
                              <Badge variant="passed" />
                            ) : h.passed === false ? (
                              <Badge variant="failed" />
                            ) : (
                              <Badge variant="complete">完了</Badge>
                            )
                          ) : h.status === 'in_progress' ? (
                            <Badge variant="in-progress" />
                          ) : (
                            <Badge variant="not-started" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          {h.score_pct != null ? `${Math.round(h.score_pct)}点` : '—'}
                        </td>
                        {isOwnReport && (
                          <td className="px-3 py-2">
                            {h.status === 'not_started' ? (
                              <span className="text-xs text-slate-300">—</span>
                            ) : confirmingResetId === h.material_id ? (
                              <span className="flex items-center gap-2 text-xs">
                                本当に戻しますか？
                                <button
                                  type="button"
                                  disabled={resettingId === h.material_id}
                                  onClick={() => handleResetProgress(h.material_id)}
                                  className="font-semibold text-red-700 hover:underline disabled:opacity-50"
                                >
                                  {resettingId === h.material_id ? '処理中...' : 'はい'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmingResetId(null)}
                                  className="text-slate-500 hover:underline"
                                >
                                  キャンセル
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmingResetId(h.material_id)}
                                className="text-xs font-semibold text-slate-500 hover:text-red-700 hover:underline"
                              >
                                未受講に戻す
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <p className="mt-6 text-xs text-slate-400">※ 学習記録は人事評価には用いません。</p>
      </div>
    </div>
  )
}
