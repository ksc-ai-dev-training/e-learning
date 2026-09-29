import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Check } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import MaterialThumbnail from '../components/ui/MaterialThumbnail'
import MyLearningToggle from '../components/ui/MyLearningToggle'
import Select from '../components/ui/Select'
import TextInput from '../components/ui/TextInput'
import { useMaterialsSearch, EMPTY_SEARCH_PARAMS } from '../hooks/useMaterialsSearch'
import type { MaterialSearchParams } from '../hooks/useMaterialsSearch'
import { useProjects } from '../hooks/useProjects'
import { formatDateJst } from '../lib/datetime'
import { projectColorClasses } from '../lib/projectColors'
import { questionTypeLabel } from '../lib/questionDefaults'
import type { EnrollmentStatus } from '../types'

const REQUIRED_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'required', label: '必修のみ' },
  { value: 'optional', label: '任意のみ' },
]

const PER_PAGE_OPTIONS = [
  { value: '20', label: '20件' },
  { value: '50', label: '50件' },
  { value: '100', label: '100件' },
]

type FilterForm = {
  q: string
  tags: string[]
  required: MaterialSearchParams['required']
  incompleteOnly: boolean
  myAssignmentsOnly: boolean
}
const EMPTY_FILTER: FilterForm = {
  q: '',
  tags: [],
  required: 'all',
  incompleteOnly: false,
  myAssignmentsOnly: false,
}

function actionLabel(status: EnrollmentStatus): string {
  if (status === 'not_started') return '受講する'
  if (status === 'in_progress') return '続きから受講'
  // 常に目次タブへ遷移するボタンのため、必修・任意問わず「復習する」で統一する
  // （マイ学習と同じ理由。2026-09-09）。「練習」をしたい場合は目次タブから切り替える。
  return '復習する'
}

// 受講状況の可視化(2026-09-29、ユーザー要望)。数値の進捗%はA-14のレスポンスに含まれていない
// ため、まずは状態ラベルのみをバッジで出す。
function ProgressStatusBadge({ status }: { status: EnrollmentStatus }) {
  if (status === 'completed') return <Badge variant="complete">受講済み</Badge>
  if (status === 'in_progress') return <Badge variant="in-progress" />
  return <Badge variant="not-started" />
}

// 受講中は「今やるべきもの」として塗りボタンで強調する。未受講・受講済みは従来どおり控えめな
// 枠線ボタンのまま（2026-09-29、ユーザー要望。全ボタンが同じ見た目で状態が伝わらないとの指摘）。
function actionButtonClass(status: EnrollmentStatus): string {
  if (status === 'in_progress') {
    return 'w-full whitespace-nowrap rounded-md border border-blue-700 bg-blue-700 px-2.5 py-1 text-center text-[12px] font-semibold text-white hover:bg-blue-800 dark:border-blue-600 dark:bg-blue-700 dark:hover:bg-blue-600'
  }
  return 'w-full whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-center text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-700'
}

// URLクエリからの絞り込み込みリンク（S-09「未受講の必修教材」等）向け。個々のキーが無ければ
// 既定値のままにする（部分指定を許容する）。
function filterFromSearchParams(params: URLSearchParams): FilterForm {
  const required = params.get('required')
  return {
    ...EMPTY_FILTER,
    required: required === 'required' || required === 'optional' ? required : EMPTY_FILTER.required,
    incompleteOnly: params.get('incomplete_only') === 'true',
    myAssignmentsOnly: params.get('my_assignments_only') === 'true',
  }
}

// S-03 教材一覧・検索（詳細設計書10.3節）。公開教材のみを対象に、プロジェクト・キーワード・
// タグ・区分・受講状況で絞り込む。
export default function MaterialsSearch() {
  const navigate = useNavigate()
  const { projects } = useProjects('learner')
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [urlSearchParams] = useSearchParams()

  // 検索条件は入力中の値（form）と適用済みの値（filter）を分け、キーワードのみ「検索」押下で
  // 反映する。区分・タグ・チェックボックスは選んだ瞬間に反映する（キーワードと違い1文字ごとの連続
  // 入力が発生しないため、選択直後に反映しても過剰な再取得にならない。「セレクト等を選んだだけでは
  // 絞り込みが反映されない」という分かりにくさの指摘を受けて変更した。2026-08-28）
  // 初期値はURLクエリ（S-09の「未受講の必修教材」等からの遷移）があればそれを使う（初回のみ、
  // 以降のブラウザバック等でのURL変化は追わない。2026-09-03）。
  const [form, setForm] = useState<FilterForm>(() => filterFromSearchParams(urlSearchParams))
  const [filter, setFilter] = useState<FilterForm>(() => filterFromSearchParams(urlSearchParams))
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState<20 | 50 | 100>(20)

  const searchParams: MaterialSearchParams = {
    ...EMPTY_SEARCH_PARAMS,
    q: filter.q,
    tags: filter.tags,
    projectId: selectedProjectId,
    required: filter.required,
    incompleteOnly: filter.incompleteOnly,
    myAssignmentsOnly: filter.myAssignmentsOnly,
    page,
    perPage,
  }
  const { items, total, availableTags, error, isLoading, mutate } = useMaterialsSearch(searchParams)

  const applyFilter = () => {
    setFilter(form)
    setPage(1)
  }
  const clearFilter = () => {
    setForm(EMPTY_FILTER)
    setFilter(EMPTY_FILTER)
    setPage(1)
  }
  const selectProject = (id: number | null) => {
    setSelectedProjectId(id)
    setPage(1)
  }
  const applyImmediate = (patch: Partial<FilterForm>) => {
    const next = { ...form, ...patch }
    setForm(next)
    setFilter(next)
    setPage(1)
  }
  const toggleTag = (tag: string) => {
    const nextTags = form.tags.includes(tag) ? form.tags.filter((t) => t !== tag) : [...form.tags, tag]
    applyImmediate({ tags: nextTags })
  }
  const changePerPage = (v: string) => {
    setPerPage(Number(v) as 20 | 50 | 100)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="教材一覧・検索" />
      <div className="px-8 py-6">
        <div className="mb-4 flex flex-wrap gap-2" role="tablist">
          <button
            type="button"
            onClick={() => selectProject(null)}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
              selectedProjectId === null
                ? 'border-blue-800 bg-blue-900 text-white dark:border-blue-700 dark:bg-blue-800'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            すべて
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectProject(p.id)}
              className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                selectedProjectId === p.id
                  ? 'border-blue-800 bg-blue-900 text-white dark:border-blue-700 dark:bg-blue-800'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {p.is_company_wide ? '📌 ' : ''}
              {p.name}
              <span className="ml-1.5 text-xs font-normal opacity-70">
                {p.material_published_count}件
              </span>
            </button>
          ))}
        </div>

        <details className="mb-4 rounded-md border border-slate-200 dark:border-neutral-800" open>
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-neutral-200">
            検索条件 <span className="ml-1 text-xs font-normal text-slate-400 dark:text-neutral-500">クリックで開閉</span>
          </summary>
          <div className="border-t border-slate-200 p-4 dark:border-neutral-800">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="m-keyword" className="text-xs font-semibold text-slate-500 dark:text-neutral-300">
                  キーワード
                </label>
                <TextInput
                  id="m-keyword"
                  type="search"
                  placeholder="教材名、見出し名"
                  value={form.q}
                  onChange={(e) => setForm({ ...form, q: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="m-required" className="text-xs font-semibold text-slate-500 dark:text-neutral-300">
                  区分
                </label>
                <Select
                  id="m-required"
                  value={form.required}
                  onChange={(v) => applyImmediate({ required: v as FilterForm['required'] })}
                  options={REQUIRED_OPTIONS}
                />
              </div>
            </div>

            {availableTags.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-500 dark:text-neutral-300">タグ（クリックで絞り込み、複数選択でOR条件）</span>
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map((tag) => {
                    const selected = form.tags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                          selected
                            ? 'border-blue-700 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-100'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
                        }`}
                      >
                        #{tag}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="mt-3.5 flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-neutral-200">
                <input
                  type="checkbox"
                  checked={form.incompleteOnly}
                  onChange={(e) => applyImmediate({ incompleteOnly: e.target.checked })}
                />
                未受講のみ表示
              </label>
              <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-neutral-200">
                <input
                  type="checkbox"
                  checked={form.myAssignmentsOnly}
                  onChange={(e) => applyImmediate({ myAssignmentsOnly: e.target.checked })}
                />
                自分が受講対象の教材のみ表示
              </label>
            </div>

            <div className="mt-3.5 flex items-center gap-2.5 border-t border-slate-100 pt-3.5 dark:border-neutral-800">
              <Button variant="primary" onClick={applyFilter}>
                検索
              </Button>
              <Button variant="secondary" onClick={clearFilter}>
                条件クリア
              </Button>
            </div>
          </div>
        </details>

        {isLoading && <p className="text-sm text-slate-400 dark:text-neutral-500">読み込み中...</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">教材一覧を取得できませんでした</p>}

        {!isLoading && !error && items.length === 0 && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400 dark:border-neutral-800 dark:bg-neutral-900">
            条件に一致する教材がありません。
          </p>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((m) => (
              <div
                key={m.id}
                className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="relative">
                  <MaterialThumbnail material={m} size="lg" />
                  <span className="absolute left-1.5 top-1.5 rounded bg-white/95 px-0.5 py-0.5 shadow-sm dark:bg-neutral-900/90">
                    <Badge variant={m.required ? 'required' : 'optional'} />
                  </span>
                  {m.progress_status === 'completed' && (
                    <span className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-green-600 shadow-sm dark:bg-neutral-900/90 dark:text-green-400">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <div className="text-[13px] font-semibold leading-snug text-slate-800 dark:text-neutral-100">
                    {m.title}
                  </div>
                  {m.description && (
                    <div className="line-clamp-2 text-[11px] text-slate-400 dark:text-neutral-500">
                      {m.description}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${projectColorClasses(m.project_id)}`}
                    >
                      {m.is_company_wide ? '📌 ' : ''}
                      {m.project_name}
                    </span>
                    {m.tags.slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                      >
                        #{t}
                      </span>
                    ))}
                    {m.tags.length > 2 && (
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500">
                        +{m.tags.length - 2}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-neutral-500">
                    {m.chapter_count}章・{m.page_count}ページ
                    {m.question_count > 0 && (
                      <>
                        {' ／ '}
                        {m.question_types.map(questionTypeLabel).join('・')} 全{m.question_count}問
                      </>
                    )}
                  </div>
                  <div className="text-[10.5px] text-slate-400 dark:text-neutral-500">
                    {m.created_by_name}・{formatDateJst(m.updated_at)}
                  </div>
                  <div className="mt-auto flex flex-col gap-1 pt-1">
                    {m.is_company_wide && !m.required && (
                      <MyLearningToggle
                        materialId={m.id}
                        registered={m.registered}
                        onToggled={() => {
                          void mutate()
                        }}
                      />
                    )}
                    <ProgressStatusBadge status={m.progress_status} />
                    <button
                      type="button"
                      onClick={() => navigate(`/materials/${m.id}`)}
                      className={actionButtonClass(m.progress_status)}
                    >
                      {actionLabel(m.progress_status)}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-sm text-slate-500 dark:text-neutral-300">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 dark:text-neutral-500">表示件数</span>
            <Select
              value={String(perPage)}
              onChange={changePerPage}
              options={PER_PAGE_OPTIONS}
              className="w-24"
            />
            <span className="text-xs text-slate-400 dark:text-neutral-500">
              {rangeStart} - {rangeEnd} / {total}件
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              «
            </Button>
            <span className="px-2 text-xs text-slate-500 dark:text-neutral-300">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              »
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
