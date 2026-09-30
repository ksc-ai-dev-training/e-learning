import { useState } from 'react'
import { Link, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import StatCard from '../components/ui/StatCard'
import { useAiGenerationPolling } from '../hooks/useAiGenerationPolling'
import { useMe } from '../hooks/useMe'
import { usePersonalAiFeedback, usePersonalAiFeedbackHistory, usePersonalReport } from '../hooks/usePersonalReport'
import { ApiError } from '../lib/api'
import { fromPersonalReport } from '../lib/backLink'
import { formatDateJst, formatDateTimeJst } from '../lib/datetime'
import { deleteMaterialHistory, resetMaterialProgress } from '../lib/materialActions'
import { requestPersonalAiFeedback } from '../lib/reportActions'
import { scrollToAndHighlight } from '../lib/scrollHighlight'
import type { EnrollmentStatus } from '../types'

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
  const { feedback, isLoading: feedbackLoading, mutate: mutateFeedback } = usePersonalAiFeedback(targetUserId, generating)
  // useAiGenerationPollingのgenerate()はsetGenerating(true)を真っ先に呼ぶため、ヘッダーの
  // 「再生成する」ボタン（generating||feedbackで表示）が、直後にfeedbackをクリアする一瞬の間も
  // 消えずに残る（2026-09-07、再生成ボタン新設時の意図をそのまま踏襲）。
  const { generateError, slowWarning, generate } = useAiGenerationPolling(
    generating,
    setGenerating,
    feedback,
    mutateFeedback,
    () => requestPersonalAiFeedback(targetUserId as number),
    'フィードバックの生成開始に失敗しました',
  )
  const handleGenerate = () => {
    if (targetUserId != null) void generate()
  }
  // 過去のAI個人フィードバックを見返す（新設、2026-09-28）。押したときだけ取得する
  // （usePersonalAiFeedbackHistoryはfeedbackHistoryOpen=falseの間キーがnullになりフェッチしない）。
  const [feedbackHistoryOpen, setFeedbackHistoryOpen] = useState(false)
  const { items: feedbackHistory, isLoading: feedbackHistoryLoading } = usePersonalAiFeedbackHistory(
    feedbackHistoryOpen ? targetUserId : null,
  )
  const [confirmingResetId, setConfirmingResetId] = useState<number | null>(null)
  const [resettingId, setResettingId] = useState<number | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [historyTab, setHistoryTab] = useState<EnrollmentStatus>('completed')

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

  // 新規（2026-09-25）: 学習履歴から削除。本人のみ実行可（isOwnReportの分岐内でのみ描画する）。
  // 受験記録は論理削除のみで、再受験回数の上限には影響しない
  // （backend/routers/learning.pyのdelete_material_history参照）
  const handleDeleteHistory = async (materialId: number) => {
    setDeleteError(null)
    setDeletingId(materialId)
    try {
      await deleteMaterialHistory(materialId)
      await mutateReport()
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : '削除に失敗しました')
    } finally {
      setDeletingId(null)
      setConfirmingDeleteId(null)
    }
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-400 dark:text-neutral-500">読み込み中...</div>
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="個人学習レポート" />
        <div className="px-8 py-6">
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
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
          <p className="mb-4 text-xs text-slate-500 dark:text-neutral-400">
            所属プロジェクト: {report.target_user.project_names.join('、')}
          </p>
        )}

        <div className="mb-6 grid max-w-3xl grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-4">
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

        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-neutral-200">AIによる個人フィードバック</h3>
        <div className="mb-6 max-w-3xl rounded-md border border-slate-200 p-4 dark:border-neutral-800">
          {scoredHistory.length > 0 && (
            <div className="mb-4 border-b border-slate-100 pb-4 dark:border-neutral-800">
              <div className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-neutral-400">教材別正答率</div>
              <div className="space-y-1">
                {scoredHistory.map((h) => (
                  <div key={h.material_id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 dark:text-neutral-200">{h.material_title}</span>
                    <span className="font-semibold text-slate-800 dark:text-neutral-100">{Math.round(h.score_pct!)}点</span>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-neutral-500">
                設問を含む受験記録がある教材のみ表示します（説明文のみのページは対象外）。
              </p>
            </div>
          )}
          {feedback ? (
            <>
              <p className="mb-3 text-sm leading-relaxed text-slate-700 dark:text-neutral-200">{feedback.comment}</p>
              {feedback.weak_areas.length > 0 && (
                <div className="mb-2">
                  <span className="mr-1.5 text-xs text-slate-500 dark:text-neutral-400">理解不足の可能性がある分野:</span>
                  {feedback.weak_areas.map((tag) => (
                    <span
                      key={tag}
                      className="mr-1 inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {feedback.recommended_materials.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">おすすめ教材</div>
                  {feedback.recommended_materials.map((m) => (
                    <a
                      key={m.id}
                      href={`/materials/${m.id}`}
                      className="mb-1.5 block rounded-md border border-slate-200 px-3 py-2 text-sm text-blue-800 hover:bg-slate-50 dark:border-neutral-800 dark:text-blue-300 dark:hover:bg-neutral-800/60"
                    >
                      {m.title}
                    </a>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-400 dark:text-neutral-500">
                このフィードバックは学習支援を目的としたものであり、人事評価には使用されません。
              </p>
              <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3 text-xs dark:border-neutral-800">
                <span className="text-slate-400 dark:text-neutral-500">{formatDateTimeJst(feedback.generated_at)} 生成</span>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="font-semibold text-blue-700 hover:underline disabled:text-slate-400 disabled:no-underline dark:text-blue-300 dark:disabled:text-neutral-500"
                >
                  {generating ? '再生成中...' : '再生成する'}
                </button>
                <button
                  type="button"
                  onClick={() => setFeedbackHistoryOpen((v) => !v)}
                  className="font-semibold text-slate-500 hover:underline dark:text-neutral-400"
                >
                  {feedbackHistoryOpen ? '過去の実行結果を閉じる' : '過去の実行結果を見る'}
                </button>
              </div>
              {feedbackHistoryOpen && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-neutral-800">
                  {feedbackHistoryLoading ? (
                    <p className="text-xs text-slate-400 dark:text-neutral-500">読み込み中...</p>
                  ) : feedbackHistory.length <= 1 ? (
                    <p className="text-xs text-slate-400 dark:text-neutral-500">過去の実行はまだありません。</p>
                  ) : (
                    <>
                      {(() => {
                        // 弱点分野の傾向。既に取得済みの履歴データ（各回のweak_areas）を数えるだけで、
                        // 新規のAI呼び出しは発生しない（2026-09-29、ユーザー要望：複数回分を横断して
                        // 「この分野は毎回指摘されている」ことが分かるようにしたい）。
                        const counts = new Map<string, number>()
                        for (const h of feedbackHistory) {
                          for (const tag of h.weak_areas) {
                            counts.set(tag, (counts.get(tag) ?? 0) + 1)
                          }
                        }
                        const trend = Array.from(counts.entries())
                          .map(([tag, count]) => ({ tag, count }))
                          .sort((a, b) => b.count - a.count)
                        if (trend.length === 0) return null
                        return (
                          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950/30">
                            <div className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-neutral-300">
                              弱点分野の傾向（直近{feedbackHistory.length}回中）
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {trend.map(({ tag, count }) => (
                                <span
                                  key={tag}
                                  className="rounded border border-amber-200 bg-white px-1.5 py-0.5 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-neutral-900 dark:text-amber-200"
                                >
                                  {tag} {count}/{feedbackHistory.length}回
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                      <ul className="flex flex-col gap-3">
                        {feedbackHistory.slice(1).map((h) => (
                          <li key={h.generated_at} className="rounded-md border border-slate-100 p-2.5 text-xs dark:border-neutral-800">
                            <div className="mb-1 text-slate-400 dark:text-neutral-500">{formatDateTimeJst(h.generated_at)}</div>
                            <p className="text-slate-600 dark:text-neutral-300">{h.comment}</p>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </>
          ) : feedbackLoading ? (
            <div className="text-sm text-slate-400 dark:text-neutral-500">読み込み中...</div>
          ) : generating ? (
            <div className="text-sm text-slate-500 dark:text-neutral-400">
              作成中...
              {slowWarning && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  生成に時間がかかっています。しばらく経っても表示されない場合は再度お試しください。
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="mb-3 text-sm text-slate-500 dark:text-neutral-400">
                まだAI個人フィードバックは生成されていません。学習傾向を分析してコメントを作成します（該当する教材があればおすすめ教材も表示します）。
              </p>
              <Button type="button" variant="secondary" onClick={handleGenerate}>
                生成する
              </Button>
              {generateError && <span className="ml-3 text-sm text-red-600 dark:text-red-400">{generateError}</span>}
            </div>
          )}
        </div>

        <div id="learning-history" className="mb-2 flex scroll-mt-4 items-baseline justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-neutral-200">学習履歴</h3>
          {(resetError || deleteError) && (
            <span className="text-sm text-red-600 dark:text-red-400">{resetError || deleteError}</span>
          )}
        </div>
        {report.history.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-neutral-500">学習履歴はまだありません。</p>
        ) : (
          <>
            <div className="mb-3 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 dark:border-neutral-800" role="tablist">
              {HISTORY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={historyTab === tab.key}
                  onClick={() => setHistoryTab(tab.key)}
                  className={`-mb-px flex-shrink-0 whitespace-nowrap border-b-2 px-3 py-1.5 text-sm font-semibold ${
                    historyTab === tab.key
                      ? 'border-blue-800 text-blue-900 dark:border-blue-500 dark:text-blue-300'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-100'
                  }`}
                >
                  {tab.label} ({historyByStatus[tab.key].length})
                </button>
              ))}
            </div>
            {visibleHistory.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-neutral-500">該当する教材はありません。</p>
            ) : (
              <div className="max-w-3xl overflow-x-auto rounded-md border border-slate-200 dark:border-neutral-800">
                <table className="w-full text-sm max-sm:whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                      <th className="px-3 py-2 font-normal">教材</th>
                      <th className="px-3 py-2 font-normal">受講日</th>
                      <th className="px-3 py-2 font-normal">結果</th>
                      <th className="px-3 py-2 text-right font-normal">スコア</th>
                      {isOwnReport && (
                        <>
                          <th className="w-24 px-3 py-2 font-normal">進捗リセット</th>
                          <th className="w-24 px-3 py-2 font-normal">履歴削除</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHistory.map((h) => (
                      <tr key={h.material_id} className="border-b border-slate-50 last:border-0 dark:border-neutral-800">
                        <td className="px-3 py-2 text-slate-800 dark:text-neutral-100">
                          {h.is_archived ? (
                            <span className="inline-flex items-center gap-1.5 text-slate-400 dark:text-neutral-500">
                              {h.material_title}
                              <Badge variant="archived" />
                            </span>
                          ) : (
                            <Link
                              to={`/materials/${h.material_id}?from=${fromPersonalReport(userIdParam ?? 'me')}`}
                              className="text-blue-800 hover:underline dark:text-blue-300"
                            >
                              {h.material_title}
                            </Link>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-neutral-300">
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
                        <td className="px-3 py-2 text-right text-slate-600 dark:text-neutral-300">
                          {h.score_pct != null ? `${Math.round(h.score_pct)}点` : '—'}
                        </td>
                        {isOwnReport && (
                          <>
                            <td className="px-3 py-2 align-top">
                              {h.status === 'not_started' ? (
                                <span className="text-xs text-slate-300 dark:text-neutral-600">—</span>
                              ) : confirmingResetId === h.material_id ? (
                                <span className="flex flex-wrap items-center gap-1.5 text-xs whitespace-nowrap">
                                  戻す？
                                  <button
                                    type="button"
                                    disabled={resettingId === h.material_id}
                                    onClick={() => handleResetProgress(h.material_id)}
                                    className="font-semibold text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"
                                  >
                                    {resettingId === h.material_id ? '処理中...' : 'はい'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmingResetId(null)}
                                    className="text-slate-500 hover:underline dark:text-neutral-400"
                                  >
                                    キャンセル
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmingResetId(h.material_id)}
                                  className="text-xs font-semibold text-slate-500 hover:text-red-700 hover:underline dark:text-neutral-400 dark:hover:text-red-300"
                                >
                                  未受講に戻す
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(h.material_id)}
                                className="text-xs font-semibold text-red-700 hover:underline dark:text-red-300"
                              >
                                履歴から削除
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {isOwnReport && visibleHistory.length > 0 && (
              <p className="mt-1.5 max-w-3xl text-[11px] text-slate-400 dark:text-neutral-500">
                「進捗リセット」は受験記録を残したまま未受講の状態に戻します（S-04の採点結果パネル・AIフィードバックには引き続き反映されます）。
                <br />
                「履歴削除」は学習履歴・採点結果・AIフィードバックの集計から見えなくなります。※どちらの操作も受験回数はリセットされません。
              </p>
            )}
          </>
        )}

        <p className="mt-6 text-xs text-slate-400 dark:text-neutral-500">※ 学習記録は人事評価には用いません。</p>
      </div>

      {confirmingDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg dark:bg-neutral-800">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-base font-semibold text-slate-800 dark:text-neutral-100">学習履歴から削除しますか？</span>
              <button
                type="button"
                onClick={() => setConfirmingDeleteId(null)}
                className="text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
              >
                ×
              </button>
            </div>
            <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-neutral-300">
              「{report.history.find((h) => h.material_id === confirmingDeleteId)?.material_title}」の受験記録が、
              学習履歴・採点結果・AIフィードバックの集計から見えなくなります。<strong>元に戻せません。</strong>
              （再受験回数の上限は変わりません）
            </p>
            {deleteError && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmingDeleteId(null)}>
                キャンセル
              </Button>
              <Button
                variant="danger-ghost"
                onClick={() => handleDeleteHistory(confirmingDeleteId)}
                disabled={deletingId === confirmingDeleteId}
              >
                {deletingId === confirmingDeleteId ? '削除中...' : '削除する'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
