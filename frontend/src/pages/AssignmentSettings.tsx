import { useMemo, useState } from 'react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Select from '../components/ui/Select'
import TextInput from '../components/ui/TextInput'
import AssignmentEditPanel from '../components/material/AssignmentEditPanel'
import { useAssignments } from '../hooks/useAssignments'
import { formatDateJst } from '../lib/datetime'
import type { AssignmentListItem } from '../types'

type SortKey = 'required' | 'updated' | 'title'

// S-06 配信設定（詳細設計書10.6節相当）。誰でもアクセスでき、admin（全教材）またはプロジェクト
// 管理者（自プロジェクトに属する教材、下書き含む）が管理対象を持つ。配信対象は「プロジェクト」
// （教材自身の所属プロジェクトに固定）と「個人」（そのプロジェクトの現役メンバーのみ）の2種類で、
// 全社Wikiの教材は常に任意固定（必修不可）。pass_score_pct等の合否判定設定はこの画面では扱わない
// （画面モックアップに該当UIが無く、A-38は対象・必修/任意・期限のみを更新する）。
export default function AssignmentSettings() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('required')
  const { items, isLoading, mutate } = useAssignments(q, status)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const projectOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const item of items) seen.set(item.project_id, item.project_name)
    return Array.from(seen.entries()).map(([id, name]) => ({ value: String(id), label: name }))
  }, [items])

  const filtered = useMemo(() => {
    let list = items
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
  }, [items, projectFilter, sort])

  const selected = filtered.find((i) => i.id === selectedId) ?? null

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
              <Select
                value={status}
                onChange={setStatus}
                options={[
                  { value: '', label: 'すべての状態' },
                  { value: 'published', label: '公開中' },
                  { value: 'draft', label: '下書き' },
                ]}
              />
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
                        <td className={`px-3 py-2 ${editing ? 'font-semibold text-blue-900' : 'text-slate-800'}`}>
                          {item.title}
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
                          <Badge variant={item.status === 'published' ? 'published' : 'draft'} />
                        </td>
                        <td className="px-3 py-2">
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
