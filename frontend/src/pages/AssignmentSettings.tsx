import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import TextInput from '../components/ui/TextInput'
import AssignmentEditPanel from '../components/material/AssignmentEditPanel'
import { useAssignments } from '../hooks/useAssignments'
import { formatDateJst } from '../lib/datetime'
import { ApiError } from '../lib/api'
import { archiveMaterial, restoreMaterial } from '../lib/materialActions'
import type { AssignmentListItem } from '../types'

type SortKey = 'required' | 'updated' | 'title'

const STATUS_OPTIONS = [
  { value: '', label: 'すべて（アーカイブ済みを除く）' },
  { value: 'published', label: '公開中' },
  { value: 'draft', label: '下書き' },
  { value: 'archived', label: 'アーカイブ済み' },
]

// S-06 配信設定（詳細設計書10.6節相当）。誰でもアクセスでき、admin（全教材）またはプロジェクト
// 管理者（自プロジェクトに属する教材、下書き含む）が管理対象を持つ。配信対象は「プロジェクト」
// （教材自身の所属プロジェクトに固定）と「個人」（そのプロジェクトの現役メンバーのみ）の2種類で、
// 全社ライブラリの教材はプロジェクトadmin以外は任意固定（必修不可、2026-09-17より前はadminであっても
// 常に不可だった）。pass_score_pct等の合否判定設定はこの画面では扱わない
// （画面モックアップに該当UIが無く、A-38は対象・必修/任意・期限のみを更新する）。
export default function AssignmentSettings() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('required')
  // 'archived'はフロントエンド側だけのフィルタ値のため、実際のAPI呼び出しでは status='' のまま
  // include_archived=trueを送り、is_archivedで絞り込む（useAssignments.tsのコメント参照）
  const { items, isLoading, mutate } = useAssignments(q, status === 'archived' ? '' : status, status === 'archived')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [archivingId, setArchivingId] = useState<number | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<AssignmentListItem | null>(null)

  // status==='archived'のときはAPI側のstatus絞り込みを送らず（useAssignmentsの呼び出し箇所参照）
  // is_archivedだけをここで絞り込むため、itemsにはアーカイブ済み以外の教材も含まれる。
  // プロジェクト絞り込みの選択肢はこの「状態」絞り込み後の集合から作る（projectFilter自体には
  // 依存させない。依存させるとプロジェクトを選ぶたびに選択肢自体が変わってしまうため）。
  // これをしないと、「アーカイブ済み」表示中に実際にはアーカイブ済み教材が1件も無いプロジェクトまで
  // 選択肢に出てしまい、選ぶと必ず0件になる不整合になる（2026-09-18、レビューで発見）。
  const statusFiltered = useMemo(
    () => (status === 'archived' ? items.filter((i) => i.is_archived) : items),
    [items, status],
  )

  const projectOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const item of statusFiltered) seen.set(item.project_id, item.project_name)
    return Array.from(seen.entries()).map(([id, name]) => ({ value: String(id), label: name }))
  }, [statusFiltered])

  const filtered = useMemo(() => {
    let list = statusFiltered
    if (projectFilter) list = list.filter((i) => String(i.project_id) === projectFilter)
    const sorted = [...list]
    if (sort === 'required') {
      sorted.sort((a, b) => Number(hasRequired(b)) - Number(hasRequired(a)))
    } else if (sort === 'updated') {
      sorted.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    } else {
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'ja'))
    }
    return sorted
  }, [statusFiltered, projectFilter, sort])

  const selected = filtered.find((i) => i.id === selectedId) ?? null

  const doArchive = async () => {
    if (!archiveTarget) return
    setArchiveError(null)
    setArchivingId(archiveTarget.id)
    try {
      await archiveMaterial(archiveTarget.id)
      await mutate()
      setArchiveTarget(null)
    } catch (e) {
      setArchiveError(e instanceof ApiError ? e.message : 'アーカイブに失敗しました')
    } finally {
      setArchivingId(null)
    }
  }

  const doRestore = async (materialId: number) => {
    setArchiveError(null)
    setArchivingId(materialId)
    try {
      await restoreMaterial(materialId)
      await mutate()
    } catch (e) {
      setArchiveError(e instanceof ApiError ? e.message : '復元に失敗しました')
    } finally {
      setArchivingId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="配信設定" />
      <div className="px-8 py-6">
        {!isLoading && items.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            <p className="mb-1 font-semibold text-slate-500">配信設定できる教材がありません</p>
            <p className="text-xs">
              あなたが管理者を務めるプロジェクトに教材が無いか、まだどのプロジェクトの管理者にもなっていません。
              <br />
              プロジェクトを作成するか、既存プロジェクトの管理者に追加してもらうと、ここに教材が表示されます。
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <TextInput
                placeholder="教材名で検索"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-56"
              />
              <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
              <Select
                value={projectFilter}
                onChange={setProjectFilter}
                options={[{ value: '', label: 'すべてのプロジェクト' }, ...projectOptions]}
              />
              <Select
                value={sort}
                onChange={(v) => setSort(v as SortKey)}
                options={[
                  { value: 'required', label: '並び順: 必修を優先' },
                  { value: 'updated', label: '並び順: 更新日が新しい順' },
                  { value: 'title', label: '並び順: 教材名順' },
                ]}
              />
              <span className="text-xs text-slate-400">{filtered.length}件表示中</span>
            </div>

            {status === 'archived' && (
              <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                アーカイブ済みの教材はここから復元できます。復元すると下書き状態に戻ります（即座には再公開されません。再公開するには教材編集画面で改めて「公開する」を押す必要があります）。
              </p>
            )}
            {archiveError && <p className="mb-3 text-sm text-red-600">{archiveError}</p>}

            {isLoading ? (
              <p className="py-8 text-center text-sm text-slate-400">読み込み中...</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-3 py-2 font-normal">教材</th>
                      <th className="px-3 py-2 font-normal">プロジェクト</th>
                      <th className="px-3 py-2 font-normal">配信対象</th>
                      <th className="px-3 py-2 font-normal">区分</th>
                      <th className="px-3 py-2 font-normal">期限</th>
                      <th className="px-3 py-2 font-normal">状態</th>
                      <th className="px-3 py-2 font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const editing = item.id === selectedId
                      return (
                      <tr
                        key={item.id}
                        className={`border-b border-slate-50 last:border-0 ${
                          editing ? 'border-l-4 border-l-blue-600 bg-blue-50' : 'border-l-4 border-l-transparent'
                        }`}
                      >
                        <td className={`px-3 py-2 ${editing ? 'font-semibold text-blue-900' : ''}`}>
                          <Link
                            to={`/projects/${item.project_id}/materials/${item.id}/edit`}
                            className={
                              editing
                                ? 'text-blue-900 hover:underline'
                                : item.is_archived
                                  ? 'text-slate-400 hover:text-blue-800 hover:underline'
                                  : 'text-slate-800 hover:text-blue-800 hover:underline'
                            }
                          >
                            {item.title}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600">
                            {item.is_company_wide ? '📌 ' : ''}
                            {item.project_name}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{scopeSummary(item)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={hasRequired(item) ? 'required' : 'optional'} />
                        </td>
                        <td className="px-3 py-2 text-slate-500">{earliestDueAt(item)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={item.is_archived ? 'archived' : item.status === 'published' ? 'published' : 'draft'} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2.5">
                            {editing ? (
                              <span className="inline-flex items-center gap-1 rounded bg-blue-700 px-2 py-1 text-xs font-semibold text-white">
                                編集中
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedId(item.id)}
                                className="text-xs font-semibold text-blue-700 hover:underline"
                              >
                                編集
                              </button>
                            )}
                            {item.can_archive && item.is_archived && (
                              <button
                                type="button"
                                onClick={() => doRestore(item.id)}
                                disabled={archivingId === item.id}
                                title="復元すると下書き状態に戻ります（再公開には改めて「公開する」操作が必要です）"
                                className="text-xs font-semibold text-slate-600 hover:underline disabled:opacity-50"
                              >
                                {archivingId === item.id ? '復元中...' : '復元'}
                              </button>
                            )}
                            {item.can_archive &&
                              !item.is_archived &&
                              (item.status === 'published' || item.has_learning_history) && (
                              <button
                                type="button"
                                onClick={() => setArchiveTarget(item)}
                                disabled={archivingId === item.id}
                                title="教材一覧・検索から非表示にします（データは削除されず、いつでも復元できます）"
                                className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                              >
                                アーカイブ
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selected && (
              <AssignmentEditPanel
                key={selected.id}
                material={selected}
                className="mt-5"
                onClose={() => setSelectedId(null)}
                onSaved={() => mutate()}
              />
            )}
          </>
        )}
      </div>

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-base font-semibold text-slate-800">教材をアーカイブしますか？</span>
              <button
                type="button"
                onClick={() => setArchiveTarget(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ×
              </button>
            </div>
            <p className="mb-3 text-sm leading-relaxed text-slate-600">
              「{archiveTarget.title}」を教材一覧・検索から非表示にします。目次・ページ・設問・添付ファイルは削除されず、受験記録やアンケート回答がある場合もそのまま保持されます。この画面の「状態」絞り込みで「アーカイブ済み」を選ぶといつでも一覧に戻して復元できます。
            </p>
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
              公開中の教材をアーカイブすると、受講者からもこの教材が見えなくなります。
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setArchiveTarget(null)}>
                キャンセル
              </Button>
              <Button variant="danger-ghost" onClick={doArchive} disabled={archivingId === archiveTarget.id}>
                {archivingId === archiveTarget.id ? 'アーカイブ中...' : 'アーカイブする'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function hasRequired(item: AssignmentListItem): boolean {
  return item.assignments.some((a) => a.required)
}

function earliestDueAt(item: AssignmentListItem): string {
  const dueDates = item.assignments.filter((a) => a.required && a.due_at).map((a) => a.due_at as string)
  if (dueDates.length === 0) return '—'
  return formatDateJst(dueDates.sort()[0])
}

function scopeSummary(item: AssignmentListItem): string {
  const project = item.assignments.find((a) => a.scope_type === 'project')
  const individuals = item.assignments.filter((a) => a.scope_type === 'individual')
  if (!project && individuals.length === 0) return '未設定'
  const parts: string[] = []
  if (project) parts.push(`プロジェクト: ${project.scope_label}（${project.member_count}名）`)
  if (individuals.length === 1) parts.push(`個人: ${individuals[0].scope_label}`)
  else if (individuals.length > 1) parts.push(`個人: ${individuals[0].scope_label} ほか${individuals.length - 1}名`)
  return parts.join(' / ')
}
