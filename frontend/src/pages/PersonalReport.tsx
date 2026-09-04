import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { useMe } from '../hooks/useMe'
import { usePersonalAiFeedback, usePersonalReport } from '../hooks/usePersonalReport'
import { ApiError } from '../lib/api'
import { formatDateJst, formatDateTimeJst } from '../lib/datetime'
import { requestPersonalAiFeedback } from '../lib/reportActions'

const GENERATING_SLOW_AFTER_MS = 3 * 60 * 1000

// S-09 個人学習レポート（詳細設計書4.7節 A-50〜A-52、10.8節）。本人、または対象者が所属する
// プロジェクトの管理者・システムadminが閲覧できる。AI個人フィードバック（F-22）は、開くたびに
// AI呼び出しの課金が発生するのを避けるため、設計書の「開いたら自動生成」ではなく「生成する」
// ボタンでの手動トリガーに変更した（2026-09-02、ユーザー判断）。
export default function PersonalReport() {
  const { userId: userIdParam } = useParams<{ userId: string }>()
  const { me } = useMe()
  const targetUserId = userIdParam === 'me' ? (me?.id ?? null) : Number(userIdParam)

  const { report, error, isLoading } = usePersonalReport(targetUserId)
  const [generating, setGenerating] = useState(false)
  const { feedback, mutate: mutateFeedback } = usePersonalAiFeedback(targetUserId, generating)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [slowWarning, setSlowWarning] = useState(false)

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
          <div className="rounded-md border border-slate-200 p-3">
            <div className="text-xs text-slate-500">受講済み教材数</div>
            <div className="text-lg font-semibold text-slate-800">{report.summary.completed_material_count}件</div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs text-slate-500">未受講の必修教材</div>
            <div className="text-lg font-semibold text-slate-800">{report.summary.incomplete_required_count}件</div>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <div className="text-xs text-slate-500">必修受講完了率</div>
            <div className="text-lg font-semibold text-slate-800">{report.summary.required_completion_pct}%</div>
          </div>
          <div className="rounded-md border border-slate-200 p-3">
            <div className="text-xs text-slate-500">直近の受講</div>
            <div className="text-sm font-semibold text-slate-800">
              {report.summary.last_activity_at ? formatDateJst(report.summary.last_activity_at) : '—'}
            </div>
          </div>
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

        <h3 className="mb-2 text-sm font-semibold text-slate-700">学習履歴</h3>
        {report.history.length === 0 ? (
          <p className="text-sm text-slate-400">学習履歴はまだありません。</p>
        ) : (
          <div className="max-w-3xl overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-normal">教材</th>
                  <th className="px-3 py-2 font-normal">受講日</th>
                  <th className="px-3 py-2 font-normal">結果</th>
                  <th className="px-3 py-2 text-right font-normal">スコア</th>
                </tr>
              </thead>
              <tbody>
                {report.history.map((h) => (
                  <tr key={h.material_id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2 text-slate-800">{h.material_title}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {h.completed_at ? formatDateJst(h.completed_at) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {h.passed === true ? (
                        <Badge variant="passed" />
                      ) : h.passed === false ? (
                        <Badge variant="failed" />
                      ) : h.completed_at ? (
                        <Badge variant="complete">完了</Badge>
                      ) : (
                        <Badge variant="in-progress" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {h.score_pct != null ? `${Math.round(h.score_pct)}点` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-slate-400">※ 学習記録は人事評価には用いません。</p>
      </div>
    </div>
  )
}
