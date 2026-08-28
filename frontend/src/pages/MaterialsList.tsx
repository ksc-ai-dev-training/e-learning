import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import TextInput from '../components/ui/TextInput'
import { useMaterials } from '../hooks/useMaterials'
import { useProjects } from '../hooks/useProjects'
import { formatDateJst, formatYearMonthJst } from '../lib/datetime'
import { ApiError } from '../lib/api'
import { restoreMaterial } from '../lib/materialActions'
import type { MaterialStatus } from '../types'

const STATUS_OPTIONS = [
  { value: 'all', label: 'すべて（アーカイブ済みを除く）' },
  { value: 'published', label: '公開中' },
  { value: 'draft', label: '下書き' },
  { value: 'archived', label: 'アーカイブ済み' },
]

type FilterForm = { keyword: string; status: string; month: string }
const EMPTY_FILTER: FilterForm = { keyword: '', status: 'all', month: 'all' }

// S-14 教材編集：教材一覧（詳細設計書10.13節）。
export default function MaterialsList() {
  const { projectId } = useParams<{ projectId: string }>()
  const id = Number(projectId)
  const { projects } = useProjects()
  const [restoringId, setRestoringId] = useState<number | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  // 検索条件は入力中の値（form）と適用済みの値（filter）を分け、キーワードのみ「絞り込む」押下で
  // 反映する。状態・更新月はプルダウンを選んだ瞬間に反映する（キーワードと違い1文字ごとの連続入力が
  // 発生しないため、選択直後に反映しても過剰な再取得にならない。「セレクトを選んだだけでは絞り込みが
  // 反映されない」という分かりにくさの指摘を受けて変更した。2026-08-28）
  const [form, setForm] = useState<FilterForm>(EMPTY_FILTER)
  const [filter, setFilter] = useState<FilterForm>(EMPTY_FILTER)
  const { materials, error, isLoading, mutate } = useMaterials(id, filter.status === 'archived')
  const project = projects.find((p) => p.id === id)

  const applyImmediate = (patch: Partial<FilterForm>) => {
    const next = { ...form, ...patch }
    setForm(next)
    setFilter(next)
  }

  const restore = async (materialId: number) => {
    setRestoreError(null)
    setRestoringId(materialId)
    try {
      await restoreMaterial(materialId)
      await mutate()
    } catch (e) {
      setRestoreError(e instanceof ApiError ? e.message : '復元に失敗しました')
    } finally {
      setRestoringId(null)
    }
  }

  const monthOptions = useMemo(() => {
    const months = new Set(materials.map((m) => formatYearMonthJst(m.updated_at)))
    const sorted = Array.from(months).sort().reverse()
    return [
      { value: 'all', label: 'すべて' },
      ...sorted.map((ym) => {
        const [y, m] = ym.split('-')
        return { value: ym, label: `${y}年${Number(m)}月` }
      }),
    ]
  }, [materials])

  const filtered = materials.filter((m) => {
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase().replace(/^#/, '')
      const titleMatch = m.title.toLowerCase().includes(kw)
      const tagMatch = m.tags.some((t) => t.toLowerCase().includes(kw))
      if (!titleMatch && !tagMatch) return false
    }
    if (filter.status === 'archived') {
      if (!m.is_archived) return false
    } else if (filter.status !== 'all' && m.status !== (filter.status as MaterialStatus)) {
      return false
    }
    if (filter.month !== 'all' && formatYearMonthJst(m.updated_at) !== filter.month) return false
    return true
  })

  const applyFilter = () => setFilter(form)
  const clearFilter = () => {
    setForm(EMPTY_FILTER)
    setFilter(EMPTY_FILTER)
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={`教材編集${project ? ` — ${project.name}` : ''}`} />
      <div className="px-8 py-6">
        <p className="mb-4 text-[11.5px] text-slate-400">
          <Link to="/materials/edit-projects" className="text-blue-800 hover:underline">
            ← プロジェクト選択に戻る
          </Link>
          {' ／ '}
          このプロジェクトの教材（下書きを含む）を一覧表示します。
        </p>

        <details className="mb-4 rounded-md border border-slate-200">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-slate-600">
            絞り込み <span className="ml-1 text-xs font-normal text-slate-400">クリックで開閉</span>
          </summary>
          <div className="border-t border-slate-200 p-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="m-keyword" className="text-xs font-semibold text-slate-500">
                  キーワード
                </label>
                <TextInput
                  id="m-keyword"
                  type="search"
                  placeholder="教材名、#タグ"
                  value={form.keyword}
                  onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="m-status" className="text-xs font-semibold text-slate-500">
                  状態
                </label>
                <Select
                  id="m-status"
                  value={form.status}
                  onChange={(v) => applyImmediate({ status: v })}
                  options={STATUS_OPTIONS}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="m-month" className="text-xs font-semibold text-slate-500">
                  更新月
                </label>
                <Select
                  id="m-month"
                  value={form.month}
                  onChange={(v) => applyImmediate({ month: v })}
                  options={monthOptions}
                />
              </div>
            </div>
            <div className="mt-3.5 flex items-center gap-2.5 border-t border-slate-100 pt-3.5">
              <Button variant="primary" onClick={applyFilter}>
                絞り込む
              </Button>
              <Button variant="secondary" onClick={clearFilter}>
                条件クリア
              </Button>
            </div>
          </div>
        </details>

        <div className="mb-4 flex items-center gap-2.5">
          <Link
            to={`/projects/${id}/materials/new/edit`}
            className="rounded-md border border-blue-800 bg-blue-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800"
          >
            ＋ このプロジェクトに新規教材を作成
          </Link>
          <span className="text-xs text-slate-400">または、下の一覧から既存の教材を編集</span>
        </div>

        {isLoading && <p className="text-sm text-slate-400">読み込み中...</p>}
        {error && <p className="text-sm text-red-600">教材一覧を取得できませんでした</p>}

        {!isLoading && !error && materials.length === 0 && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            教材がありません。「＋ このプロジェクトに新規教材を作成」から作成してください。
          </p>
        )}

        {!isLoading && !error && materials.length > 0 && filtered.length === 0 && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            条件に一致する教材がありません。
          </p>
        )}

        {restoreError && <p className="mb-3 text-sm text-red-600">{restoreError}</p>}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-semibold">教材</th>
                  <th className="w-24 px-3 py-2 font-semibold">状態</th>
                  <th className="w-28 px-3 py-2 font-semibold">構成</th>
                  <th className="w-28 px-3 py-2 font-semibold">更新日</th>
                  {filter.status === 'archived' && <th className="w-24 px-3 py-2 font-semibold">操作</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      {m.is_archived ? (
                        <span className="text-slate-400">{m.title}</span>
                      ) : (
                        <Link
                          to={`/projects/${id}/materials/${m.id}/edit`}
                          className="text-slate-800 hover:text-blue-800 hover:underline"
                        >
                          {m.title}
                        </Link>
                      )}
                      {m.tags.length > 0 && (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {m.tags.map((t) => `#${t}`).join(' ')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={m.is_archived ? 'archived' : m.status === 'published' ? 'published' : 'draft'} />
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {m.chapter_count}章・{m.page_count}ページ
                    </td>
                    <td className="px-3 py-2 text-slate-500">{formatDateJst(m.updated_at)}</td>
                    {filter.status === 'archived' && (
                      <td className="px-3 py-2">
                        <Button
                          variant="secondary"
                          onClick={() => restore(m.id)}
                          disabled={restoringId === m.id}
                          title="教材一覧・検索に戻します"
                        >
                          {restoringId === m.id ? '復元中...' : '復元'}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
