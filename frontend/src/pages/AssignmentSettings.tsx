import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import TextInput from '../components/ui/TextInput'
import { useAssignments } from '../hooks/useAssignments'
import { useMaterialAssignments } from '../hooks/useMaterialAssignments'
import { useProjectMemberships } from '../hooks/useProjectMemberships'
import { ApiError } from '../lib/api'
import { updateMaterialAssignments } from '../lib/assignmentActions'
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

function AssignmentEditPanel({
  material,
  onClose,
  onSaved,
}: {
  material: AssignmentListItem
  onClose: () => void
  onSaved: () => void
}) {
  const { assignments, isLoading } = useMaterialAssignments(material.id)
  const { memberships } = useProjectMemberships(material.project_id)
  const activeMembers = memberships.filter((m) => m.status === 'active' && m.left_at === null)

  const [projectEnabled, setProjectEnabled] = useState(false)
  const [projectAssignmentId, setProjectAssignmentId] = useState<number | null>(null)
  const [projectRequired, setProjectRequired] = useState(false)
  const [projectDueAt, setProjectDueAt] = useState('')
  const [individuals, setIndividuals] = useState<
    { id: number | null; userId: number; name: string; required: boolean; dueAt: string }[]
  >([])
  const [addingUserId, setAddingUserId] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const project = assignments.find((a) => a.scope_type === 'project')
    // 公開済みの教材はプロジェクトメンバーであれば元々閲覧・受講できる（F-25の既定アクセス）ため、
    // 配信設定が未設定でも実質的にはプロジェクト全体へ任意公開されているのと同じ状態にある。
    // 初めて編集パネルを開いたとき（＝まだ配信行が無いとき）は、この実態に合わせて既定でチェック
    // 済み・任意にしておく（下書きはそもそも一般メンバーに見えないため対象外。ユーザーフィードバック
    // により2026-09-01追加）。既存の配信行がある場合は常にその実データを優先する。
    setProjectEnabled(project ? true : material.status === 'published')
    setProjectAssignmentId(project?.id ?? null)
    setProjectRequired(project?.required ?? false)
    setProjectDueAt(project?.due_at ? formatDateJst(project.due_at) : '')
    setIndividuals(
      assignments
        .filter((a) => a.scope_type === 'individual')
        .map((a) => ({
          id: a.id,
          userId: a.scope_id,
          name: a.scope_label,
          required: a.required,
          dueAt: a.due_at ? formatDateJst(a.due_at) : '',
        })),
    )
  }, [assignments])

  const candidateOptions = activeMembers.filter(
    (m) => !individuals.some((i) => i.userId === m.user_id),
  )

  const isCompanyWide = material.is_company_wide

  const addIndividual = () => {
    const userId = Number(addingUserId)
    const member = activeMembers.find((m) => m.user_id === userId)
    if (!member) return
    setIndividuals((prev) => [
      ...prev,
      { id: null, userId, name: member.user_name, required: false, dueAt: '' },
    ])
    setAddingUserId('')
  }

  const removeIndividual = (userId: number) => {
    setIndividuals((prev) => prev.filter((i) => i.userId !== userId))
  }

  const targetCount = projectEnabled ? activeMembers.length : individuals.length

  const handleSave = async () => {
    setSaveError(null)
    setSaving(true)
    try {
      const payload = [
        ...(projectEnabled
          ? [
              {
                id: projectAssignmentId,
                scope_type: 'project' as const,
                scope_id: material.project_id,
                required: !isCompanyWide && projectRequired,
                due_at: !isCompanyWide && projectRequired && projectDueAt ? projectDueAt : null,
              },
            ]
          : []),
        ...individuals.map((i) => ({
          id: i.id,
          scope_type: 'individual' as const,
          scope_id: i.userId,
          required: !isCompanyWide && i.required,
          due_at: !isCompanyWide && i.required && i.dueAt ? i.dueAt : null,
        })),
      ]
      await updateMaterialAssignments(material.id, payload)
      onSaved()
      onClose()
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-5 rounded-md border border-blue-200 border-l-4 border-l-blue-600 shadow-sm">
      <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-4 py-2.5">
        <span className="text-sm font-semibold text-blue-900">配信設定を編集 — {material.title}</span>
      </div>
      <div className="flex flex-col gap-4 p-4">
        {isLoading ? (
          <p className="text-sm text-slate-400">読み込み中...</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={projectEnabled}
                  onChange={(e) => setProjectEnabled(e.target.checked)}
                />
                プロジェクト全体に配信する
              </label>
              <div className="flex items-center gap-2 pl-5">
                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                  {material.project_name}
                </span>
                <span className="text-xs text-slate-400">この教材が属するプロジェクトです（変更不可）</span>
              </div>
            </div>

            {projectEnabled && (
              <div className="flex flex-col gap-2 pl-5">
                <div className="flex items-center gap-4 text-sm">
                  <label
                    className="flex items-center gap-1.5"
                    title={isCompanyWide ? '全社Wikiの教材は必修にできません' : undefined}
                  >
                    <input
                      type="radio"
                      checked={projectRequired}
                      disabled={isCompanyWide}
                      onChange={() => setProjectRequired(true)}
                    />
                    必修
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={!projectRequired} onChange={() => setProjectRequired(false)} />
                    任意
                  </label>
                  {isCompanyWide && (
                    <span className="text-xs text-slate-400">
                      全社Wikiの教材は必修にできません（常に任意）
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-500">受講期限（必修の場合のみ）</label>
                  <TextInput
                    type="date"
                    value={projectDueAt}
                    disabled={!projectRequired}
                    onChange={(e) => setProjectDueAt(e.target.value)}
                    className="w-40"
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
              <label className="text-xs font-semibold text-slate-500">個人を追加指定（任意）</label>
              <p className="text-xs text-slate-400">
                プロジェクト全体の設定とは別に、このプロジェクトの特定メンバーだけ個別の必修・期限を上書きしたい場合に使います。選択肢はこのプロジェクトの現役メンバーに限られます。
              </p>
              {individuals.length > 0 && (
                <div className="flex flex-col gap-2">
                  {individuals.map((i) => (
                    <div key={i.userId} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
                      <span className="min-w-[6rem] text-sm text-slate-800">{i.name}</span>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="radio"
                          checked={i.required}
                          disabled={isCompanyWide}
                          onChange={() =>
                            setIndividuals((prev) =>
                              prev.map((x) => (x.userId === i.userId ? { ...x, required: true } : x)),
                            )
                          }
                        />
                        必修
                      </label>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="radio"
                          checked={!i.required}
                          onChange={() =>
                            setIndividuals((prev) =>
                              prev.map((x) => (x.userId === i.userId ? { ...x, required: false } : x)),
                            )
                          }
                        />
                        任意
                      </label>
                      <TextInput
                        type="date"
                        value={i.dueAt}
                        disabled={!i.required}
                        onChange={(e) =>
                          setIndividuals((prev) =>
                            prev.map((x) => (x.userId === i.userId ? { ...x, dueAt: e.target.value } : x)),
                          )
                        }
                        className="w-36"
                      />
                      <button
                        type="button"
                        onClick={() => removeIndividual(i.userId)}
                        className="ml-auto text-xs font-semibold text-red-700 hover:underline"
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Select
                  value={addingUserId}
                  onChange={setAddingUserId}
                  options={[
                    { value: '', label: 'プロジェクトメンバーから選択…' },
                    ...candidateOptions.map((m) => ({ value: String(m.user_id), label: m.user_name })),
                  ]}
                  className="max-w-[280px]"
                />
                <Button variant="secondary" disabled={!addingUserId} onClick={addIndividual}>
                  追加
                </Button>
              </div>
            </div>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}

            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </Button>
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                キャンセル
              </Button>
              <span className="ml-auto text-xs text-slate-500">
                対象者プレビュー:{' '}
                <strong className="text-slate-700">
                  {projectEnabled ? `${material.project_name} 所属 ${targetCount}名` : `${targetCount}名（個人指定のみ）`}
                </strong>
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
