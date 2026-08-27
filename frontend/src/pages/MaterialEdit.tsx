import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import TagInput from '../components/ui/TagInput'
import TextInput from '../components/ui/TextInput'
import { useMaterial } from '../hooks/useMaterial'
import { useMaterialAttachments } from '../hooks/useMaterialAttachments'
import { useMaterialRevisions } from '../hooks/useMaterialRevisions'
import { useProjectMemberships } from '../hooks/useProjectMemberships'
import { useProjects } from '../hooks/useProjects'
import { ApiError, apiFetch, apiFetchText } from '../lib/api'
import { formatDateJst, formatDateTimeJst, formatYearMonthJst } from '../lib/datetime'
import { buildMaterialSource } from '../lib/materialSource'
import type { EditableNode } from '../lib/materialSource'
import type { Material, MaterialNode } from '../types'

const TABS = [
  { key: 'structure', label: '目次編集' },
  { key: 'attach', label: 'ファイル・リンク' },
  { key: 'members', label: 'プロジェクトメンバー' },
  { key: 'review', label: 'AIレビュー結果' },
  { key: 'history', label: '改訂履歴' },
] as const
type TabKey = (typeof TABS)[number]['key']

function toEditableChapters(toc: MaterialNode[]): EditableNode[] {
  return toc
    .filter((n) => n.kind === 'chapter')
    .map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      kind: 'chapter' as const,
      children: chapter.children
        .filter((c) => c.kind === 'section')
        .map((section) => ({ id: section.id, title: section.title, kind: 'section' as const, children: [] })),
    }))
}

// S-05 教材編集：目次編集（詳細設計書10.5節）の縮小版。今回のスコープは教材の新規作成と
// 章・小見出しの目次構造編集まで（ページ内容編集=S-17、公開判定・AI設定・アンケート等は対象外）。
export default function MaterialEdit() {
  const { projectId, materialId } = useParams<{ projectId: string; materialId: string }>()
  const navigate = useNavigate()
  const isNew = materialId === 'new'
  const { material, isLoading, error: materialError, mutate } = useMaterial(isNew ? null : Number(materialId))
  const { projects } = useProjects()
  const project = projects.find((p) => p.id === Number(projectId))

  const [savedId, setSavedId] = useState<number | null>(isNew ? null : Number(materialId))
  const [activeTab, setActiveTab] = useState<TabKey>('structure')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [chapters, setChapters] = useState<EditableNode[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [historyYear, setHistoryYear] = useState('')
  const [historyMonth, setHistoryMonth] = useState('all')

  const { attachments, isLoading: attachmentsLoading } = useMaterialAttachments(
    activeTab === 'attach' ? savedId : null,
  )
  // ヘッダーの「プロジェクト管理者」表示にも使うため、タブ表示中かどうかに関わらず取得する
  const { memberships, isLoading: membershipsLoading } = useProjectMemberships(Number(projectId))
  const projectAdminNames = memberships.filter((m) => m.role === 'admin').map((m) => m.user_name)
  const { revisions, isLoading: revisionsLoading } = useMaterialRevisions(
    activeTab === 'history' ? savedId : null,
  )

  useEffect(() => {
    if (material) {
      setTitle(material.title)
      setTags(material.tags)
      setChapters(toEditableChapters(material.toc ?? []))
      setSavedId(material.id)
    }
  }, [material])

  // 保存完了メッセージは一定時間で消す（10.5節）
  useEffect(() => {
    if (!savedMessage) return
    const timer = setTimeout(() => setSavedMessage(null), 3000)
    return () => clearTimeout(timer)
  }, [savedMessage])

  // 改訂履歴の対象年月は既定で直近（最新の改訂がある年月）に絞る（画面モックアップ、10.5節）
  useEffect(() => {
    if (revisions.length > 0 && historyYear === '') {
      const [y, m] = formatYearMonthJst(revisions[0].created_at).split('-')
      setHistoryYear(y)
      setHistoryMonth(m)
    }
  }, [revisions, historyYear])

  const revisionYears = Array.from(
    new Set(revisions.map((r) => formatYearMonthJst(r.created_at).slice(0, 4))),
  ).sort((a, b) => b.localeCompare(a))
  const revisionMonthsForYear = Array.from(
    new Set(
      revisions
        .filter((r) => formatYearMonthJst(r.created_at).startsWith(historyYear))
        .map((r) => formatYearMonthJst(r.created_at).slice(5, 7)),
    ),
  ).sort((a, b) => b.localeCompare(a))
  const filteredRevisions =
    historyYear === 'all'
      ? revisions
      : revisions.filter((r) => {
          const ym = formatYearMonthJst(r.created_at)
          if (!ym.startsWith(historyYear)) return false
          if (historyMonth !== 'all' && ym.slice(5, 7) !== historyMonth) return false
          return true
        })

  const selectHistoryYear = (value: string) => {
    setHistoryYear(value)
    setHistoryMonth('all')
  }

  const withMeta = (m: Material): Material => ({ ...m, title, tags })

  // 「下書き保存」押下時にタイトル・タグ・目次構造をまとめて保存する。章・小見出しの
  // 追加/削除/並び替え/リネームはこの保存まではローカルstateのみで、A-20は呼ばない
  // （以前は操作のたびに自動保存していたが、保存押下時にまとめて確定する方式に変更した）。
  const saveDraft = async () => {
    setError(null)
    setSavedMessage(null)
    if (title.trim().length === 0) {
      setError('教材タイトルを入力してください')
      return
    }
    setSaving(true)
    try {
      if (savedId === null) {
        const created = await apiFetch<Material>('/api/materials', {
          method: 'POST',
          body: JSON.stringify({ project_id: Number(projectId), title, tags }),
        })
        setSavedId(created.id)
        navigate(`/projects/${projectId}/materials/${created.id}/edit`, { replace: true })
      } else if (material) {
        const source = buildMaterialSource(withMeta(material), chapters)
        await apiFetchText(`/api/materials/${savedId}/source`, source)
        await mutate()
      }
      setSavedMessage('保存しました')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const addChapter = () => {
    setChapters([...chapters, { id: null, title: `第${chapters.length + 1}章`, kind: 'chapter', children: [] }])
  }

  const addSection = (chapterIdx: number) => {
    setChapters(
      chapters.map((c, i) =>
        i === chapterIdx
          ? { ...c, children: [...c.children, { id: null, title: '', kind: 'section' as const, children: [] }] }
          : c,
      ),
    )
  }

  const renameChapter = (idx: number, value: string) => {
    setChapters((prev) => prev.map((c, i) => (i === idx ? { ...c, title: value } : c)))
  }

  const renameSection = (chapterIdx: number, sectionIdx: number, value: string) => {
    setChapters((prev) =>
      prev.map((c, i) =>
        i === chapterIdx
          ? { ...c, children: c.children.map((s, j) => (j === sectionIdx ? { ...s, title: value } : s)) }
          : c,
      ),
    )
  }

  const moveChapter = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= chapters.length) return
    const next = [...chapters]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setChapters(next)
  }

  const moveSection = (chapterIdx: number, sectionIdx: number, dir: -1 | 1) => {
    const chapter = chapters[chapterIdx]
    const target = sectionIdx + dir
    if (target < 0 || target >= chapter.children.length) return
    const nextChildren = [...chapter.children]
    ;[nextChildren[sectionIdx], nextChildren[target]] = [nextChildren[target], nextChildren[sectionIdx]]
    setChapters(chapters.map((c, i) => (i === chapterIdx ? { ...c, children: nextChildren } : c)))
  }

  const deleteChapter = (idx: number) => {
    setChapters(chapters.filter((_, i) => i !== idx))
    setPendingDelete(null)
  }

  const deleteSection = (chapterIdx: number, sectionIdx: number) => {
    setChapters(
      chapters.map((c, i) =>
        i === chapterIdx ? { ...c, children: c.children.filter((_, j) => j !== sectionIdx) } : c,
      ),
    )
    setPendingDelete(null)
  }

  if (!isNew && isLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (!isNew && materialError) {
    const message =
      materialError instanceof ApiError && materialError.status === 403
        ? 'この教材を閲覧できません。全社公開プロジェクトの下書きは作成者とプロジェクト管理者のみ閲覧できます。'
        : '教材を取得できませんでした。'
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="教材編集" />
        <div className="px-8 py-6">
          <Link to={`/projects/${projectId}/materials/edit`} className="text-blue-800 hover:underline">
            ← 教材一覧に戻る
          </Link>
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={`教材編集${title ? ` — ${title}` : ''}`} />
      <div className="px-8 py-6">
        <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-400">
          <Link to="/materials/edit-projects" className="text-blue-800 hover:underline">
            ← プロジェクト選択に戻る
          </Link>
          <span>／</span>
          <Link to={`/projects/${projectId}/materials/edit`} className="text-blue-800 hover:underline">
            ← 教材一覧に戻る
          </Link>
          {savedId !== null && <Badge variant={material?.status === 'published' ? 'published' : 'draft'} />}
          {project && (
            <>
              <span>／ 紐づくプロジェクト: {project.name}</span>
              <span className="inline-flex items-center gap-1">
                ／ あなたのロール: <Badge variant={project.role} />
              </span>
            </>
          )}
          {!membershipsLoading && projectAdminNames.length > 0 && (
            <span>／ プロジェクト管理者: {projectAdminNames.join('、')}</span>
          )}
        </p>

        <div className="mb-5 flex gap-1 border-b border-slate-200" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                activeTab === tab.key
                  ? 'border-blue-800 text-blue-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        {savedMessage && (
          <p className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {savedMessage}
          </p>
        )}

        {activeTab === 'structure' && (
        <>
        <div className="mb-4 flex max-w-xl flex-col gap-1">
          <label htmlFor="m-title" className="text-xs font-semibold text-slate-500">
            教材タイトル
          </label>
          <TextInput
            id="m-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>

        <div className="mb-5 flex max-w-xl gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500">プロジェクト</label>
            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
              {project?.name ?? '—'}
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="m-tags" className="text-xs font-semibold text-slate-500">
              タグ（任意）
            </label>
            <TagInput id="m-tags" value={tags} onChange={setTags} />
          </div>
        </div>

        <div className="mb-6">
          <Button variant="primary" onClick={saveDraft} disabled={saving}>
            下書き保存
          </Button>
          <Button
            variant="secondary"
            className="ml-2"
            disabled
            title="準備中（公開判定の実装後に有効化）"
          >
            公開する
          </Button>
        </div>

        <section className="rounded-md border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">目次構造</span>
            <span className="text-xs text-slate-400">
              {chapters.length}章（変更は上の「下書き保存」を押すまで確定しません）
            </span>
          </div>
          <div className="p-4">
            {savedId === null && (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                先に「下書き保存」してください。教材が作成されると章・小見出しを追加できます。
              </p>
            )}

            {savedId !== null && (
              <>
                {chapters.map((chapter, ci) => (
                  <div key={chapter.id ?? `new-${ci}`} className="mb-3 rounded-md border border-slate-200">
                    <div className="flex items-center gap-2 rounded-t-md bg-slate-50 px-3 py-2">
                      <span className="flex-shrink-0 text-xs font-bold text-blue-800">第{ci + 1}章</span>
                      <TextInput
                        value={chapter.title}
                        onChange={(e) => renameChapter(ci, e.target.value)}
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => moveChapter(ci, -1)}
                        disabled={ci === 0}
                        title="上へ"
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveChapter(ci, 1)}
                        disabled={ci === chapters.length - 1}
                        title="下へ"
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      {pendingDelete === `chapter:${ci}` ? (
                        <span className="flex flex-shrink-0 items-center gap-1 text-xs">
                          本当に削除？
                          <button
                            type="button"
                            onClick={() => deleteChapter(ci)}
                            className="rounded bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700"
                          >
                            削除する
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(null)}
                            className="rounded border border-slate-300 px-2 py-1 text-slate-500 hover:bg-slate-100"
                          >
                            キャンセル
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDelete(`chapter:${ci}`)}
                          className="flex-shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          削除
                        </button>
                      )}
                    </div>

                    <div className="p-3">
                      {chapter.children.map((section, si) => (
                        <div
                          key={section.id ?? `new-${si}`}
                          className="mb-1.5 ml-6 flex items-center gap-2 rounded-md border-l-2 border-slate-200 bg-slate-50 px-2.5 py-1.5"
                        >
                          <TextInput
                            value={section.title}
                            onChange={(e) => renameSection(ci, si, e.target.value)}
                            placeholder="小見出しのタイトルを入力"
                            className="flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => moveSection(ci, si, -1)}
                            disabled={si === 0}
                            title="上へ"
                            className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSection(ci, si, 1)}
                            disabled={si === chapter.children.length - 1}
                            title="下へ"
                            className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                          >
                            ↓
                          </button>
                          {pendingDelete === `section:${ci}:${si}` ? (
                            <span className="flex flex-shrink-0 items-center gap-1 text-xs">
                              本当に削除？
                              <button
                                type="button"
                                onClick={() => deleteSection(ci, si)}
                                className="rounded bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700"
                              >
                                削除する
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(null)}
                                className="rounded border border-slate-300 px-2 py-1 text-slate-500 hover:bg-slate-100"
                              >
                                キャンセル
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDelete(`section:${ci}:${si}`)}
                              className="flex-shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            >
                              削除
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="mt-1.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => addSection(ci)}
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          + 小見出しを追加
                        </button>
                        <button
                          type="button"
                          disabled
                          title="準備中（ページ編集S-17の実装後に有効化）"
                          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-300"
                        >
                          + ページを追加
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addChapter}
                  className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  + 見出しを追加（第{chapters.length + 1}章）
                </button>
              </>
            )}
          </div>
        </section>
        </>
        )}

        {activeTab === 'attach' && (
          <section className="rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-700">添付ファイル・リンク（教材全体）</span>
            </div>
            <div className="p-4">
              <p className="mb-3 text-xs text-slate-400">
                このページに追加した各ページの添付を含む、教材に含まれるファイル・リンクの一覧です。追加はページ編集（S-17）から行います。
              </p>
              {savedId === null && <TabGateMessage />}
              {savedId !== null && attachmentsLoading && <p className="text-sm text-slate-400">読み込み中...</p>}
              {savedId !== null && !attachmentsLoading && attachments.length === 0 && (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                  まだファイル・リンクがありません。
                </p>
              )}
              {savedId !== null && attachments.length > 0 && (
                <div className="divide-y divide-slate-100">
                  {attachments.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="flex-1 truncate">{a.filename}</span>
                      <span className="text-xs text-slate-400">
                        {a.kind === 'file' ? a.mime_type : a.external_url}
                        {a.node_id === null ? '（教材全体）' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'members' && (
          <section className="rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-700">プロジェクトメンバー</span>
            </div>
            <div className="p-4">
              <p className="mb-3 text-xs text-slate-400">
                このタブは参照専用です。メンバーの追加・削除・ロール変更はプロジェクト管理画面（S-12）で行います。
              </p>
              {savedId === null && <TabGateMessage />}
              {savedId !== null && membershipsLoading && <p className="text-sm text-slate-400">読み込み中...</p>}
              {savedId !== null && !membershipsLoading && (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                        <th className="px-3 py-2 font-semibold">氏名</th>
                        <th className="w-28 px-3 py-2 font-semibold">全社ロール</th>
                        <th className="w-32 px-3 py-2 font-semibold">プロジェクトロール</th>
                        <th className="w-28 px-3 py-2 font-semibold">参加日</th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberships.map((m) => (
                        <tr key={m.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2">{m.user_name}</td>
                          <td className="px-3 py-2 text-slate-500">{m.global_role}</td>
                          <td className="px-3 py-2 text-slate-500">{m.role}</td>
                          <td className="px-3 py-2 text-slate-500">{formatDateJst(m.joined_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'review' && (
          <section className="rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-700">AIレビュー結果</span>
            </div>
            <div className="p-4">
              {savedId === null ? (
                <TabGateMessage />
              ) : (
                <>
                  <Button variant="primary" disabled title="準備中（AI連携の実装後に有効化）">
                    AIレビューを実行
                  </Button>
                  <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                    まだAIレビューを実行していません。
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        {activeTab === 'history' && (
          <section className="rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-700">改訂履歴</span>
            </div>
            <div className="p-4">
              {savedId === null && <TabGateMessage />}
              {savedId !== null && revisionsLoading && <p className="text-sm text-slate-400">読み込み中...</p>}
              {savedId !== null && !revisionsLoading && revisions.length === 0 && (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                  まだ改訂履歴がありません。
                </p>
              )}
              {savedId !== null && revisions.length > 0 && (
                <>
                  <div className="mb-3 flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-500">対象年月</label>
                    <div className="flex gap-2">
                      <Select
                        value={historyYear}
                        onChange={selectHistoryYear}
                        options={[
                          { value: 'all', label: '全期間' },
                          ...revisionYears.map((y) => ({ value: y, label: `${y}年` })),
                        ]}
                        className="w-24"
                      />
                      <Select
                        value={historyMonth}
                        onChange={setHistoryMonth}
                        disabled={historyYear === 'all'}
                        options={[
                          { value: 'all', label: 'すべて' },
                          ...revisionMonthsForYear.map((m) => ({ value: m, label: `${Number(m)}月` })),
                        ]}
                        className="w-24"
                      />
                    </div>
                  </div>

                  {filteredRevisions.length === 0 ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                      対象年月に一致する改訂履歴がありません。
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-slate-200">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                            <th className="w-40 px-3 py-2 font-semibold">日時</th>
                            <th className="w-28 px-3 py-2 font-semibold">変更者</th>
                            <th className="px-3 py-2 font-semibold">変更内容</th>
                            <th className="w-24 px-3 py-2 font-semibold">経路</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRevisions.map((r) => (
                            <tr key={r.id} className="border-b border-slate-100 last:border-0">
                              <td className="px-3 py-2 text-slate-500">{formatDateTimeJst(r.created_at)}</td>
                              <td className="px-3 py-2">{r.changed_by_name}</td>
                              <td className="px-3 py-2">{r.change_summary}</td>
                              <td className="px-3 py-2 text-slate-500">
                                {r.changed_via === 'web' ? '画面' : 'Claude Code'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function TabGateMessage() {
  return (
    <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
      先に「下書き保存」してください。教材を保存すると利用できます。
    </p>
  )
}
