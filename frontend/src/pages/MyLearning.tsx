import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import MaterialCard from '../components/ui/MaterialCard'
import Panel from '../components/ui/Panel'
import StatCard from '../components/ui/StatCard'
import { useMyLearning, useMyLearningHistory } from '../hooks/useMyLearning'
import { formatDateJst } from '../lib/datetime'
import type { MyLearningItem } from '../types'

type ViewTab = 'assigned' | 'history'

function isUrgent(item: MyLearningItem): boolean {
  if (!item.required || !item.due_at || item.progress_status === 'completed') return false
  const daysLeft = Math.ceil((new Date(item.due_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return daysLeft <= 7
}

function actionLabelFor(item: MyLearningItem): string {
  if (item.next_action === 'start') return '受講を開始'
  if (item.next_action === 'resume') return '続きから受講'
  return item.required ? '復習する' : '反復演習する'
}

interface ProjectTab {
  id: number | null
  name: string
  isCompanyWide: boolean
  count: number
}

// S-02 マイ学習（詳細設計書10.2節）。ルート"/"。
export default function MyLearning() {
  const { required, optional, stats, isLoading } = useMyLearning()
  const [viewTab, setViewTab] = useState<ViewTab>('assigned')
  const { items: historyItems, isLoading: historyLoading } = useMyLearningHistory(viewTab === 'history')
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [optionalCompletedOnly, setOptionalCompletedOnly] = useState(false)

  const allItems = useMemo(() => [...required, ...optional], [required, optional])

  const projectTabs = useMemo<ProjectTab[]>(() => {
    const byId = new Map<number, ProjectTab>()
    for (const item of allItems) {
      if (!byId.has(item.project_id)) {
        byId.set(item.project_id, {
          id: item.project_id,
          name: item.project_name,
          isCompanyWide: item.is_company_wide,
          count: 0,
        })
      }
      byId.get(item.project_id)!.count += 1
    }
    const tabs = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    const companyWide = tabs.find((t) => t.isCompanyWide)
    const rest = tabs.filter((t) => !t.isCompanyWide)
    const pinned: ProjectTab = companyWide ?? { id: -1, name: '全社Wiki', isCompanyWide: true, count: 0 }
    return [{ id: null, name: 'すべて', isCompanyWide: false, count: allItems.length }, pinned, ...rest]
  }, [allItems])

  const filterByProject = (items: MyLearningItem[]) =>
    activeProjectId === null ? items : items.filter((i) => i.project_id === activeProjectId)

  const filteredRequired = filterByProject(required)
  const urgentRequired = filteredRequired.filter(isUrgent)
  const filteredOptional = filterByProject(optional).filter(
    (i) => !optionalCompletedOnly || i.progress_status === 'completed',
  )
  const filteredHistory = filterByProject(historyItems)

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="マイ学習"
        actions={
          <Link
            to="/materials"
            className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            教材を探す
          </Link>
        }
      />
      <div className="px-8 py-6">
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="所属プロジェクトで絞り込み">
          {projectTabs.map((tab) => (
            <button
              key={tab.id ?? 'all'}
              type="button"
              onClick={() => setActiveProjectId(tab.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                activeProjectId === tab.id
                  ? 'border-blue-700 bg-blue-50 text-blue-800'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.name}
              <span className="text-slate-400">{tab.count}件</span>
            </button>
          ))}
        </div>

        <div className="mb-5 flex gap-1 border-b border-slate-200" role="tablist">
          {(
            [
              { key: 'assigned', label: '必修・任意' },
              { key: 'history', label: '学習履歴' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setViewTab(tab.key)}
              className={`border-b-2 px-3 py-2 text-sm font-semibold ${
                viewTab === tab.key ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {viewTab === 'assigned' ? (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="必修教材 受講率" value={stats?.required_completion_pct ?? 0} unit="%" />
              <StatCard
                label="期限が近い必修教材"
                value={stats?.urgent_required_count ?? 0}
                unit="件"
                tone="warn"
                linkTo={urgentRequired.length > 0 ? '#urgent-materials' : undefined}
              />
              <StatCard
                label="任意教材 受講済み"
                value={stats?.optional_completed_count ?? 0}
                unit="件"
                onClick={() => {
                  setOptionalCompletedOnly(true)
                  document.getElementById('optional-materials')?.scrollIntoView({ behavior: 'smooth' })
                }}
              />
              <StatCard
                label="直近の受講"
                value={stats?.last_activity_at ? formatDateJst(stats.last_activity_at) : '—'}
              />
            </div>

            {urgentRequired.length > 0 && (
              <div id="urgent-materials">
                <Panel title="期限が近い必修教材" count="受講しないと期限超過になります" tone="warn">
                  {urgentRequired.map((item) => (
                    <MaterialCard
                      key={item.id}
                      item={item}
                      actionLabel={actionLabelFor(item)}
                      to={`/materials/${item.id}?from=my-learning`}
                      urgent
                    />
                  ))}
                </Panel>
              </div>
            )}

            <Panel
              title="必修教材"
              count={`${filteredRequired.length}件中 ${
                filteredRequired.filter((i) => i.progress_status !== 'completed').length
              }件 未完了`}
            >
              {filteredRequired.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">対象の必修教材はありません。</p>
              ) : (
                filteredRequired.map((item) => (
                  <MaterialCard
                    key={item.id}
                    item={item}
                    actionLabel={actionLabelFor(item)}
                    to={`/materials/${item.id}?from=my-learning`}
                  />
                ))
              )}
            </Panel>

            <div id="optional-materials">
              <Panel
                title="任意教材"
                count={
                  optionalCompletedOnly ? (
                    <>
                      受講済み {filteredOptional.length}件{' '}
                      <button
                        type="button"
                        onClick={() => setOptionalCompletedOnly(false)}
                        className="text-blue-700 underline"
                      >
                        すべて表示
                      </button>
                    </>
                  ) : (
                    'おすすめ・自由選択の教材'
                  )
                }
              >
                {filteredOptional.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">
                    {optionalCompletedOnly ? '受講済みの任意教材はありません。' : '対象の任意教材はありません。'}
                  </p>
                ) : (
                  filteredOptional.map((item) => (
                    <MaterialCard
                      key={item.id}
                      item={item}
                      actionLabel={actionLabelFor(item)}
                      to={`/materials/${item.id}?from=my-learning`}
                    />
                  ))
                )}
              </Panel>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              ※「全社Wiki」タブは常に先頭に固定表示されます。全社Wiki所属の任意教材は、S-03「教材一覧・検索」から
              「マイ学習に追加」しない限りここには表示されません。
            </p>
          </>
        ) : (
          <>
            <p className="mb-4 text-xs text-slate-500">
              マイ学習への登録有無や現在の受講対象かどうかを問わず、一度でも着手した教材を確認できます。
            </p>
            <Panel title="学習履歴" count={`${filteredHistory.length}件`}>
              {historyLoading ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">読み込み中...</p>
              ) : filteredHistory.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">まだ着手した教材はありません。</p>
              ) : (
                filteredHistory.map((item) => (
                  <MaterialCard
                    key={item.id}
                    item={item}
                    actionLabel={actionLabelFor(item)}
                    to={`/materials/${item.id}?from=my-learning`}
                  />
                ))
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}
