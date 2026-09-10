import { useEffect, useState } from 'react'
import PageHeader from '../components/layout/PageHeader'
import Button from '../components/ui/Button'
import StatCard from '../components/ui/StatCard'
import { useMe } from '../hooks/useMe'
import { useProjects } from '../hooks/useProjects'
import { useDashboardStats, useIncompleteUsers, useOrgReport } from '../hooks/useDashboard'
import { requestOrgReport } from '../lib/dashboardActions'
import { sendProjectSlackReminder } from '../lib/projectActions'
import { ApiError } from '../lib/api'
import { formatDateJst, formatDateTimeJst } from '../lib/datetime'

const GENERATING_SLOW_AFTER_MS = 3 * 60 * 1000

function parseScope(scope: string): { scope_type: 'company' | 'project'; scope_id: number | null } {
  if (scope === 'company') return { scope_type: 'company', scope_id: null }
  return { scope_type: 'project', scope_id: Number(scope.slice('project:'.length)) }
}

function daysRemainingLabel(dueAt: string | null): string {
  if (!dueAt) return '—'
  const diffMs = new Date(dueAt).getTime() - Date.now()
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000))
  if (days < 0) return `${Math.abs(days)}日超過`
  if (days === 0) return '本日まで'
  return `あと${days}日`
}

// S-08 受講状況ダッシュボード（基本設計書4.10節、A-45〜A-46, A-48〜A-49）。閲覧権限はadmin
// （全社スコープ）と対象プロジェクトの管理者（自プロジェクトのスコープ）のみ（editorは対象外、
// 2026-09-08ユーザー確認）。モックアップにあった未受講者一覧の行ごと「Slackで催促」ボタンは、
// Slack連携がプロジェクト単位Incoming Webhook（チャンネル投稿のみ）方式のため実装せず、一覧表示
// のみとした（個人名をチャンネルに出したくないというユーザー判断、2026-09-08。個別の催促は
// S-12と同じく運用でカバーする）。
// 代わりに、S-12（ProjectManagement.tsx）の「必修教材のリマインドをSlackに送信」
// （F-12, send_project_slack_reminder）をこの画面からも呼べるようにした（2026-09-09、
// ユーザー要望）。担当範囲がプロジェクト単位のときのみボタンを表示する。「全社」スコープは
// 単一のSlackチャンネルに対応しない（プロジェクトごとにWebhook URLを持つ設計のため）うえ、
// 全社スコープを選べるのはシステムadminのみなので表示しない。
export default function Dashboard() {
  const { me } = useMe()
  const { projects, isLoading: projectsLoading } = useProjects('admin')
  const [scope, setScope] = useState<string | null>(null)
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [slowWarning, setSlowWarning] = useState(false)
  const [sendingSlack, setSendingSlack] = useState(false)
  const [slackResult, setSlackResult] = useState<string | null>(null)
  const [slackError, setSlackError] = useState<string | null>(null)

  const isSystemAdmin = me?.role === 'admin'
  const scopeOptions = [
    ...(isSystemAdmin ? [{ value: 'company', label: '全社' }] : []),
    ...projects.map((p) => ({ value: `project:${p.id}`, label: p.name })),
  ]

  useEffect(() => {
    if (scope == null && scopeOptions.length > 0) setScope(scopeOptions[0].value)
  }, [scope, scopeOptions.length])

  const { stats, isLoading: statsLoading } = useDashboardStats(scope)
  const { items: incompleteUsers } = useIncompleteUsers(scope)
  const { report, isLoading: reportLoading, mutate: mutateReport } = useOrgReport(scope, generating)

  useEffect(() => {
    if (generating && report) setGenerating(false)
  }, [generating, report])

  useEffect(() => {
    if (!generating) {
      setSlowWarning(false)
      return
    }
    const timer = setTimeout(() => setSlowWarning(true), GENERATING_SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [generating])

  const handleSendSlack = async () => {
    if (scope == null) return
    const { scope_type, scope_id } = parseScope(scope)
    if (scope_type !== 'project' || scope_id === null) return
    setSlackError(null)
    setSlackResult(null)
    setSendingSlack(true)
    try {
      await sendProjectSlackReminder(scope_id)
      setSlackResult('Slackに送信しました。')
    } catch (e) {
      setSlackError(e instanceof ApiError ? e.message : '送信に失敗しました')
    } finally {
      setSendingSlack(false)
    }
  }

  const handleGenerate = async () => {
    if (scope == null) return
    setGenerateError(null)
    setSlowWarning(false)
    setGenerating(true)
    try {
      await mutateReport(null, false)
      const { scope_type, scope_id } = parseScope(scope)
      await requestOrgReport(scope_type, scope_id)
      await mutateReport()
    } catch (e) {
      setGenerateError(e instanceof ApiError ? e.message : 'レポートの生成開始に失敗しました')
      setGenerating(false)
    }
  }

  if (projectsLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (scopeOptions.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="受講状況ダッシュボード" />
        <div className="px-8 py-6">
          <p className="text-sm text-slate-400">
            閲覧できるプロジェクトがありません（プロジェクトの管理者になっているプロジェクトのみ表示できます）。
          </p>
        </div>
      </div>
    )
  }

  const filteredIncompleteUsers = selectedMaterialId
    ? incompleteUsers.filter((u) => u.material_id === selectedMaterialId)
    : incompleteUsers

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="受講状況ダッシュボード" />
      <div className="px-8 py-6">
        <div className="mb-6 flex items-center gap-2">
          <label className="text-sm text-slate-500" htmlFor="dashboard-scope">
            担当範囲
          </label>
          <select
            id="dashboard-scope"
            value={scope ?? ''}
            onChange={(e) => {
              setScope(e.target.value)
              setSelectedMaterialId(null)
              setSlackResult(null)
              setSlackError(null)
            }}
            className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm"
          >
            {scopeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {scope != null && parseScope(scope).scope_type === 'project' && (
            <>
              <Button variant="secondary" onClick={handleSendSlack} disabled={sendingSlack}>
                {sendingSlack ? '送信中...' : '必修教材のリマインドをSlackに送信'}
              </Button>
              {slackResult && <span className="text-sm text-green-700">{slackResult}</span>}
              {slackError && <span className="text-sm text-red-600">{slackError}</span>}
            </>
          )}
        </div>

        {statsLoading || !stats ? (
          <div className="text-sm text-slate-400">読み込み中...</div>
        ) : (
          <>
            <div className="mb-6 grid max-w-3xl grid-cols-4 gap-3">
              <StatCard label="対象教材数" value={stats.target_material_count} unit="件" />
              <StatCard label="必修受講率" value={stats.required_completion_rate} unit="%" />
              <StatCard label="合格率" value={stats.pass_rate} unit="%" />
              <StatCard label="未受講者数" value={stats.incomplete_count} unit="人" tone="warn" />
            </div>

            <h3 className="mb-2 text-sm font-semibold text-slate-700">教材別受講率</h3>
            <div className="mb-6 max-w-3xl rounded-md border border-slate-200 p-4">
              {stats.by_material.length === 0 ? (
                <p className="text-sm text-slate-400">対象の必修教材がありません。</p>
              ) : (
                <div className="space-y-2.5">
                  {stats.by_material.map((m) => (
                    <button
                      key={m.material_id}
                      type="button"
                      onClick={() => setSelectedMaterialId(selectedMaterialId === m.material_id ? null : m.material_id)}
                      className="block w-full text-left"
                    >
                      <div className="mb-0.5 flex items-center justify-between text-sm">
                        <span className={selectedMaterialId === m.material_id ? 'font-semibold text-blue-800' : 'text-slate-700'}>
                          {m.material_title}
                        </span>
                        <span className="text-slate-500">
                          {m.completion_rate}%（{m.completed_count}/{m.member_count}人）
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-blue-800"
                          style={{ width: `${m.completion_rate}%` }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-slate-700">未受講者一覧</h3>
              {selectedMaterialId && (
                <button
                  type="button"
                  onClick={() => setSelectedMaterialId(null)}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  絞り込みを解除
                </button>
              )}
            </div>
            {filteredIncompleteUsers.length === 0 ? (
              <p className="mb-6 text-sm text-slate-400">未受講者はいません。</p>
            ) : (
              <div className="mb-6 max-w-3xl overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-3 py-2 font-normal">氏名</th>
                      <th className="px-3 py-2 font-normal">教材</th>
                      <th className="px-3 py-2 font-normal">期限</th>
                      <th className="px-3 py-2 font-normal">残り日数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIncompleteUsers.map((u) => (
                      <tr key={`${u.user_id}-${u.material_id}`} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-2 text-slate-800">{u.user_name}</td>
                        <td className="px-3 py-2 text-slate-700">{u.material_title}</td>
                        <td className="px-3 py-2 text-slate-500">{u.due_at ? formatDateJst(u.due_at) : '期限未設定'}</td>
                        <td className="px-3 py-2 text-slate-500">{daysRemainingLabel(u.due_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 className="mb-2 text-sm font-semibold text-slate-700">AI組織レポート</h3>
            <div className="max-w-3xl rounded-md border border-slate-200 p-4">
              {report ? (
                <>
                  <p className="mb-3 text-sm leading-relaxed text-slate-700">{report.summary}</p>
                  {report.insight_tags.length > 0 && (
                    <div className="mb-2">
                      {report.insight_tags.map((tag) => (
                        <span
                          key={tag}
                          className="mr-1.5 mb-1.5 inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3 text-xs">
                    <span className="text-slate-400">{formatDateTimeJst(report.generated_at)} 生成</span>
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={generating}
                      className="font-semibold text-blue-700 hover:underline disabled:text-slate-400 disabled:no-underline"
                    >
                      {generating ? '再生成中...' : '再生成する'}
                    </button>
                  </div>
                </>
              ) : reportLoading ? (
                <div className="text-sm text-slate-400">読み込み中...</div>
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
                    まだAI組織レポートは生成されていません。この担当範囲の受講状況（集計後の数値のみ）を分析して所見を作成します。
                  </p>
                  <Button type="button" variant="secondary" onClick={handleGenerate}>
                    生成する
                  </Button>
                  {generateError && <span className="ml-3 text-sm text-red-600">{generateError}</span>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
