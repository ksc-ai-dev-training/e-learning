import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import TagInput from '../components/ui/TagInput'
import TextInput from '../components/ui/TextInput'
import { useMaterial } from '../hooks/useMaterial'
import { ApiError, apiFetch, apiFetchText } from '../lib/api'
import { buildMaterialSource } from '../lib/materialSource'
import type { EditableNode } from '../lib/materialSource'
import type { Material, MaterialNode } from '../types'

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
  const { material, isLoading, mutate } = useMaterial(isNew ? null : Number(materialId))

  const [savedId, setSavedId] = useState<number | null>(isNew ? null : Number(materialId))
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [chapters, setChapters] = useState<EditableNode[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  useEffect(() => {
    if (material) {
      setTitle(material.title)
      setTags(material.tags)
      setChapters(toEditableChapters(material.toc ?? []))
      setSavedId(material.id)
    }
  }, [material])

  const withMeta = (m: Material): Material => ({ ...m, title, tags })

  const saveDraft = async () => {
    setError(null)
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
      } else {
        await apiFetch<Material>(`/api/materials/${savedId}`, {
          method: 'PUT',
          body: JSON.stringify({ title, tags, status: 'draft' }),
        })
        await mutate()
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const saveToc = async (nextChapters: EditableNode[]) => {
    if (savedId === null || !material) return
    setError(null)
    try {
      const source = buildMaterialSource(withMeta(material), nextChapters)
      await apiFetchText(`/api/materials/${savedId}/source`, source)
      await mutate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '目次の保存に失敗しました')
    }
  }

  const updateChapters = (next: EditableNode[], persist: boolean) => {
    setChapters(next)
    if (persist) saveToc(next)
  }

  const addChapter = () => {
    updateChapters(
      [...chapters, { id: null, title: `第${chapters.length + 1}章`, kind: 'chapter', children: [] }],
      true,
    )
  }

  const addSection = (chapterIdx: number) => {
    updateChapters(
      chapters.map((c, i) =>
        i === chapterIdx
          ? { ...c, children: [...c.children, { id: null, title: '新しい小見出し', kind: 'section' as const, children: [] }] }
          : c,
      ),
      true,
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
    updateChapters(next, true)
  }

  const moveSection = (chapterIdx: number, sectionIdx: number, dir: -1 | 1) => {
    const chapter = chapters[chapterIdx]
    const target = sectionIdx + dir
    if (target < 0 || target >= chapter.children.length) return
    const nextChildren = [...chapter.children]
    ;[nextChildren[sectionIdx], nextChildren[target]] = [nextChildren[target], nextChildren[sectionIdx]]
    updateChapters(
      chapters.map((c, i) => (i === chapterIdx ? { ...c, children: nextChildren } : c)),
      true,
    )
  }

  const deleteChapter = (idx: number) => {
    updateChapters(chapters.filter((_, i) => i !== idx), true)
    setPendingDelete(null)
  }

  const deleteSection = (chapterIdx: number, sectionIdx: number) => {
    updateChapters(
      chapters.map((c, i) =>
        i === chapterIdx ? { ...c, children: c.children.filter((_, j) => j !== sectionIdx) } : c,
      ),
      true,
    )
    setPendingDelete(null)
  }

  if (!isNew && isLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={`教材編集${title ? ` — ${title}` : ''}`} />
      <div className="px-8 py-6">
        <p className="mb-4 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-400">
          <Link to={`/projects/${projectId}/materials/edit`} className="text-blue-800 hover:underline">
            ← 教材一覧に戻る
          </Link>
          {savedId !== null && <Badge variant={material?.status === 'published' ? 'published' : 'draft'} />}
        </p>

        {error && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

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

        <div className="mb-5 flex max-w-xl flex-col gap-1">
          <label htmlFor="m-tags" className="text-xs font-semibold text-slate-500">
            タグ
          </label>
          <TagInput id="m-tags" value={tags} onChange={setTags} />
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
            <span className="text-xs text-slate-400">{chapters.length}章</span>
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
                        onBlur={() => saveToc(chapters)}
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
                          className="mb-1.5 flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5"
                        >
                          <TextInput
                            value={section.title}
                            onChange={(e) => renameSection(ci, si, e.target.value)}
                            onBlur={() => saveToc(chapters)}
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
      </div>
    </div>
  )
}
