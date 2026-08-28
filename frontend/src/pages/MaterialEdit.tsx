import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import AttachmentList from '../components/material/AttachmentList'
import SurveyEditModal from '../components/material/SurveyEditModal'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import TagInput from '../components/ui/TagInput'
import TextArea from '../components/ui/TextArea'
import TextInput from '../components/ui/TextInput'
import { useMaterial } from '../hooks/useMaterial'
import { useMaterialAttachments } from '../hooks/useMaterialAttachments'
import { useMaterialRevisions } from '../hooks/useMaterialRevisions'
import { useProjectMemberships } from '../hooks/useProjectMemberships'
import { useProjects } from '../hooks/useProjects'
import { useQuestionsSummary } from '../hooks/useQuestionsSummary'
import { useSurveys } from '../hooks/useSurveys'
import { ApiError, apiFetch, apiFetchText } from '../lib/api'
import { formatDateJst, formatDateTimeJst, formatYearMonthJst } from '../lib/datetime'
import { buildMaterialSource } from '../lib/materialSource'
import { archiveMaterial, deleteMaterial, publishMaterial, restoreMaterial } from '../lib/materialActions'
import { pageKindLabel, toEditableChapters } from '../lib/materialTree'
import { questionTypeLabel } from '../lib/questionDefaults'
import type { Material } from '../types'

const TABS = [
  { key: 'structure', label: '目次編集' },
  { key: 'questions', label: '問題一覧' },
  { key: 'attach', label: 'ファイル・リンク' },
  { key: 'members', label: 'プロジェクトメンバー' },
  { key: 'review', label: 'AIレビュー結果' },
  { key: 'history', label: '改訂履歴' },
] as const
type TabKey = (typeof TABS)[number]['key']

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
  const [description, setDescription] = useState('')
  const [attemptScope, setAttemptScope] = useState<Material['attempt_scope']>('material')
  const [retakeScope, setRetakeScope] = useState<Material['retake_scope']>('all')
  const [gradingMode, setGradingMode] = useState<Material['grading_mode']>('ai')
  const [defaultFeedbackStyle, setDefaultFeedbackStyle] =
    useState<Material['default_feedback_style']>('show_answer')
  const [aiContext, setAiContext] = useState('')
  const [chapters, setChapters] = useState<EditableNode[]>([])
  const [saving, setSaving] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveModalOpen, setArchiveModalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [historyYear, setHistoryYear] = useState('')
  const [historyMonth, setHistoryMonth] = useState('all')
  // 目次編集タブの未保存の変更フラグ。true の間はページ編集（S-17）への移動を禁止する
  // （移動先はサーバーから目次を取り直すため、未保存の削除等がそこで無かったことになり、
  // 保存し直すと復活・重複してしまう不具合があった。2026-08-27発見）
  const [dirty, setDirty] = useState(false)
  const markDirty = () => setDirty(true)

  const { attachments, isLoading: attachmentsLoading } = useMaterialAttachments(
    activeTab === 'attach' ? savedId : null,
  )
  // ヘッダーの「プロジェクト管理者」表示にも使うため、タブ表示中かどうかに関わらず取得する
  const { memberships, isLoading: membershipsLoading } = useProjectMemberships(Number(projectId))
  const projectAdminNames = memberships.filter((m) => m.role === 'admin').map((m) => m.user_name)
  const { revisions, isLoading: revisionsLoading } = useMaterialRevisions(
    activeTab === 'history' ? savedId : null,
  )
  const { surveys, mutate: mutateSurveys } = useSurveys(savedId)
  const [surveyModal, setSurveyModal] = useState<{ nodeId: number | null; targetLabel: string } | null>(null)
  const surveyFor = (nodeId: number | null) => surveys.find((s) => s.node_id === nodeId)
  const { items: questionSummaryItems, isLoading: questionsSummaryLoading } = useQuestionsSummary(
    activeTab === 'questions' ? savedId : null,
  )

  useEffect(() => {
    if (material) {
      setTitle(material.title)
      setTags(material.tags)
      setDescription(material.description ?? '')
      setAttemptScope(material.attempt_scope)
      setRetakeScope(material.retake_scope)
      setGradingMode(material.grading_mode)
      setDefaultFeedbackStyle(material.default_feedback_style)
      setAiContext(material.ai_context ?? '')
      setChapters(toEditableChapters(material.toc ?? []))
      setSavedId(material.id)
      setDirty(false)
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

  const withMeta = (m: Material): Material => ({
    ...m,
    title,
    tags,
    description: description.trim() ? description : null,
    attempt_scope: attemptScope,
    retake_scope: retakeScope,
    grading_mode: gradingMode,
    default_feedback_style: defaultFeedbackStyle,
    ai_context: aiContext.trim() ? aiContext : null,
  })

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
      setDirty(false)
      setSavedMessage('保存しました')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // 章・小見出し・ページ・設問のidをすべてnullにし、書き戻し時にA-20が新規ノードとして
  // 採番するようにする（複製先の教材に元教材のノードIDをそのまま送ると「存在しません」で422になる）
  const stripIds = (nodes: EditableNode[]): EditableNode[] =>
    nodes.map((n) => ({
      ...n,
      id: null,
      children: stripIds(n.children),
      questions: n.questions?.map((q) => ({ ...q, id: null })),
    }))

  // 「複製」: 教材1冊分（目次・全ページ・問題）を丸ごとコピーして新規下書きを作成する
  // （A-19相当のローカルstate取得→A-16新規作成→A-20書き戻しの内部合成。10.5節）
  const duplicateMaterial = async () => {
    if (!material || savedId === null || dirty) return
    setError(null)
    setDuplicating(true)
    try {
      const copyTitle = `${title}のコピー`
      const created = await apiFetch<Material>('/api/materials', {
        method: 'POST',
        body: JSON.stringify({ project_id: Number(projectId), title: copyTitle, description, tags }),
      })
      const source = buildMaterialSource(
        {
          ...created,
          attempt_scope: attemptScope,
          retake_scope: retakeScope,
          grading_mode: gradingMode,
          default_feedback_style: defaultFeedbackStyle,
          ai_context: aiContext.trim() ? aiContext : null,
          sort_order: material.sort_order,
        },
        stripIds(chapters),
      )
      await apiFetchText(`/api/materials/${created.id}/source`, source)
      navigate(`/projects/${projectId}/materials/${created.id}/edit`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '複製に失敗しました')
    } finally {
      setDuplicating(false)
    }
  }

  // 「アーカイブ」: ソフトデリート。目次・ページ・設問・添付ファイル・受験記録・アンケート回答は
  // 削除せず、教材一覧・検索（A-21等）から非表示にするのみ。「復元」でいつでも戻せる（A-84/A-85）
  const doArchive = async () => {
    if (savedId === null) return
    setError(null)
    setArchiving(true)
    try {
      await archiveMaterial(savedId)
      await mutate()
      setArchiveModalOpen(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'アーカイブに失敗しました')
    } finally {
      setArchiving(false)
    }
  }

  const doRestore = async () => {
    if (savedId === null) return
    setError(null)
    setArchiving(true)
    try {
      await restoreMaterial(savedId)
      await mutate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '復元に失敗しました')
    } finally {
      setArchiving(false)
    }
  }

  // 「削除」: 一度も公開したことのない下書きのみ対象の物理削除（A-18）。目次・ページ・設問・
  // 添付ファイル・改訂履歴はCASCADEで削除され、復元はできない
  const doDelete = async () => {
    if (savedId === null) return
    setError(null)
    setDeleting(true)
    try {
      await deleteMaterial(savedId)
      navigate(`/projects/${projectId}/materials/edit`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  // 「公開する」: 保存時点（A-20/A-31）で設問の必須項目は既に検証済みのため、
  // 公開時に改めて内容検証は行わない（単にstatusを変更するだけ）
  const doPublish = async () => {
    if (savedId === null) return
    setError(null)
    setPublishing(true)
    try {
      await publishMaterial(savedId)
      await mutate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '公開に失敗しました')
    } finally {
      setPublishing(false)
    }
  }

  const addChapter = () => {
    markDirty()
    setChapters([...chapters, { id: null, title: `第${chapters.length + 1}章`, kind: 'chapter', children: [] }])
  }

  const addSection = (chapterIdx: number) => {
    markDirty()
    setChapters(
      chapters.map((c, i) =>
        i === chapterIdx
          ? { ...c, children: [...c.children, { id: null, title: '', kind: 'section' as const, children: [] }] }
          : c,
      ),
    )
  }

  const renameChapter = (idx: number, value: string) => {
    markDirty()
    setChapters((prev) => prev.map((c, i) => (i === idx ? { ...c, title: value } : c)))
  }

  // chapter.children は小見出し・ページが混在する（章に直接ぶら下がるページも許容するため）。
  // title変更・並び替え・削除は種別を問わず同じ配列操作でよいため、既存のSection向け関数をそのまま使う。
  const renameSection = (chapterIdx: number, sectionIdx: number, value: string) => {
    markDirty()
    setChapters((prev) =>
      prev.map((c, i) =>
        i === chapterIdx
          ? { ...c, children: c.children.map((s, j) => (j === sectionIdx ? { ...s, title: value } : s)) }
          : c,
      ),
    )
  }

  const renamePageInSection = (chapterIdx: number, sectionIdx: number, pageIdx: number, value: string) => {
    markDirty()
    setChapters((prev) =>
      prev.map((c, i) =>
        i === chapterIdx
          ? {
              ...c,
              children: c.children.map((s, j) =>
                j === sectionIdx
                  ? { ...s, children: s.children.map((p, k) => (k === pageIdx ? { ...p, title: value } : p)) }
                  : s,
              ),
            }
          : c,
      ),
    )
  }

  const deletePageInSection = (chapterIdx: number, sectionIdx: number, pageIdx: number) => {
    markDirty()
    setChapters((prev) =>
      prev.map((c, i) =>
        i === chapterIdx
          ? {
              ...c,
              children: c.children.map((s, j) =>
                j === sectionIdx ? { ...s, children: s.children.filter((_, k) => k !== pageIdx) } : s,
              ),
            }
          : c,
      ),
    )
    setPendingDelete(null)
  }

  // ページ編集（S-17）は開くたびにサーバーから目次を取り直すため、目次編集タブに
  // 未保存の変更がある状態で移動すると、その変更（削除等）が無かったことになってしまう。
  // そのため未保存の間は移動させず、先に「下書き保存」を促す。
  const goToNewPage = (parentNodeId: number) => {
    if (dirty) {
      setError('保存していない変更があります。ページ編集に移動する前に「下書き保存」を押してください。')
      return
    }
    navigate(`/projects/${projectId}/materials/${savedId}/pages/new/edit?parentNodeId=${parentNodeId}`)
  }

  const goToEditPage = (nodeId: number) => {
    if (dirty) {
      setError('保存していない変更があります。ページ編集に移動する前に「下書き保存」を押してください。')
      return
    }
    navigate(`/projects/${projectId}/materials/${savedId}/pages/${nodeId}/edit`)
  }

  const moveChapter = (idx: number, dir: -1 | 1) => {
    markDirty()
    const target = idx + dir
    if (target < 0 || target >= chapters.length) return
    const next = [...chapters]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setChapters(next)
  }

  const moveSection = (chapterIdx: number, sectionIdx: number, dir: -1 | 1) => {
    markDirty()
    const chapter = chapters[chapterIdx]
    const target = sectionIdx + dir
    if (target < 0 || target >= chapter.children.length) return
    const nextChildren = [...chapter.children]
    ;[nextChildren[sectionIdx], nextChildren[target]] = [nextChildren[target], nextChildren[sectionIdx]]
    setChapters(chapters.map((c, i) => (i === chapterIdx ? { ...c, children: nextChildren } : c)))
  }

  // chapter.children はページ・小見出しが混在するため、moveSectionと同じ配列操作でページの
  // 並び替えにも使える（章直下のページ・小見出しをまとめて並び替える）
  const movePageInChapter = (chapterIdx: number, childIdx: number, dir: -1 | 1) => moveSection(chapterIdx, childIdx, dir)

  const movePageInSection = (chapterIdx: number, sectionIdx: number, pageIdx: number, dir: -1 | 1) => {
    markDirty()
    setChapters((prev) =>
      prev.map((c, i) => {
        if (i !== chapterIdx) return c
        return {
          ...c,
          children: c.children.map((s, j) => {
            if (j !== sectionIdx) return s
            const target = pageIdx + dir
            if (target < 0 || target >= s.children.length) return s
            const nextChildren = [...s.children]
            ;[nextChildren[pageIdx], nextChildren[target]] = [nextChildren[target], nextChildren[pageIdx]]
            return { ...s, children: nextChildren }
          }),
        }
      }),
    )
  }

  const deleteChapter = (idx: number) => {
    markDirty()
    setChapters(chapters.filter((_, i) => i !== idx))
    setPendingDelete(null)
  }

  const deleteSection = (chapterIdx: number, sectionIdx: number) => {
    markDirty()
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
          {savedId !== null && (
            <Badge
              variant={material?.is_archived ? 'archived' : material?.status === 'published' ? 'published' : 'draft'}
            />
          )}
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
            onChange={(e) => {
              markDirty()
              setTitle(e.target.value)
            }}
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
            <TagInput
              id="m-tags"
              value={tags}
              onChange={(v) => {
                markDirty()
                setTags(v)
              }}
            />
          </div>
        </div>

        <div className="mb-5 flex max-w-xl flex-col gap-1">
          <label htmlFor="m-description" className="text-xs font-semibold text-slate-500">
            概要（一覧表示用、任意）
          </label>
          <TextArea
            id="m-description"
            value={description}
            onChange={(e) => {
              markDirty()
              setDescription(e.target.value)
            }}
            maxLength={500}
            rows={2}
          />
        </div>

        <section className="mb-5 max-w-xl rounded-md border border-slate-200">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">合否判定・再受験設定</span>
          </div>
          <div className="flex flex-wrap gap-4 p-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">受験単位</label>
              <Select
                value={attemptScope}
                onChange={(v) => {
                  markDirty()
                  setAttemptScope(v as Material['attempt_scope'])
                }}
                options={[
                  { value: 'material', label: '教材全体' },
                  { value: 'chapter', label: '章' },
                  { value: 'section', label: '小見出し' },
                  { value: 'page', label: 'ページ' },
                ]}
                className="w-32"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">再受験範囲</label>
              <Select
                value={retakeScope}
                onChange={(v) => {
                  markDirty()
                  setRetakeScope(v as Material['retake_scope'])
                }}
                options={[
                  { value: 'all', label: '全問' },
                  { value: 'wrong_only', label: '誤答のみ' },
                ]}
                className="w-32"
              />
            </div>
          </div>
        </section>

        <section className="mb-5 max-w-xl rounded-md border border-slate-200">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">AI採点・AIアシスト設定</span>
          </div>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500">採点方式の既定</label>
                <Select
                  value={gradingMode}
                  onChange={(v) => {
                    markDirty()
                    setGradingMode(v as Material['grading_mode'])
                  }}
                  options={[
                    { value: 'ai', label: 'AI自動採点' },
                    { value: 'manual', label: '手動採点' },
                  ]}
                  className="w-36"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500">AI講評スタイルの既定</label>
                <Select
                  value={defaultFeedbackStyle}
                  onChange={(v) => {
                    markDirty()
                    setDefaultFeedbackStyle(v as Material['default_feedback_style'])
                  }}
                  options={[
                    { value: 'show_answer', label: '正解提示' },
                    { value: 'review_only', label: 'コードレビュー型' },
                    { value: 'hint_only', label: 'ヒント型' },
                  ]}
                  className="w-40"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="m-ai-context" className="text-xs font-semibold text-slate-500">
                AI採点・AIアシストへの指示（任意）
              </label>
              <TextArea
                id="m-ai-context"
                value={aiContext}
                onChange={(e) => {
                  markDirty()
                  setAiContext(e.target.value)
                }}
                maxLength={2000}
                rows={3}
                placeholder="言語・フレームワーク・採点上の注意点など、AIへの前提条件を自由に記述できます"
              />
            </div>
          </div>
        </section>

        <section className="mb-5 max-w-xl rounded-md border border-slate-200">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">受験後アンケート（教材全体）</span>
          </div>
          <div className="flex items-center justify-between gap-3 p-4">
            {surveyFor(null) ? (
              <span className="text-sm text-slate-600">
                「{surveyFor(null)!.title}」を設置中{surveyFor(null)!.is_active ? '' : '（現在OFF）'}
              </span>
            ) : (
              <span className="text-sm text-slate-400">まだ設置されていません</span>
            )}
            {savedId !== null && (
              <Button
                variant="secondary"
                onClick={() => setSurveyModal({ nodeId: null, targetLabel: '教材全体' })}
              >
                {surveyFor(null) ? '編集する' : 'アンケートを設置'}
              </Button>
            )}
          </div>
        </section>

        <div className="mb-6">
          <Button variant="primary" onClick={saveDraft} disabled={saving}>
            下書き保存
          </Button>
          {savedId !== null && material?.status === 'draft' && (
            <Button
              variant="secondary"
              className="ml-2"
              onClick={doPublish}
              disabled={publishing || dirty}
              title={dirty ? '保存していない変更があります。先に「下書き保存」を押してください' : undefined}
            >
              {publishing ? '公開中...' : '公開する'}
            </Button>
          )}
          {savedId !== null && (
            <Button
              variant="secondary"
              className="ml-2"
              onClick={duplicateMaterial}
              disabled={duplicating || dirty}
              title={dirty ? '保存していない変更があります。先に「下書き保存」を押してください' : undefined}
            >
              {duplicating ? '複製中...' : '複製'}
            </Button>
          )}
          {savedId !== null && material?.is_archived && (
            <Button variant="secondary" className="ml-2" onClick={doRestore} disabled={archiving}>
              {archiving ? '復元中...' : '復元'}
            </Button>
          )}
          {savedId !== null && !material?.is_archived && material?.status === 'published' && (
            <Button
              variant="danger-ghost"
              className="ml-2"
              onClick={() => setArchiveModalOpen(true)}
              disabled={archiving}
              title="教材一覧・検索から非表示にします（データは削除されず、いつでも復元できます）"
            >
              アーカイブ
            </Button>
          )}
          {savedId !== null && material?.status === 'draft' && (
            <Button
              variant="danger-ghost"
              className="ml-2"
              onClick={() => setDeleteModalOpen(true)}
              disabled={deleting}
              title="この教材を完全に削除します（元に戻せません）"
            >
              削除
            </Button>
          )}
        </div>

        {archiveModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-base font-semibold text-slate-800">教材をアーカイブしますか？</span>
                <button
                  type="button"
                  onClick={() => setArchiveModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ×
                </button>
              </div>
              <p className="mb-3 text-sm leading-relaxed text-slate-600">
                「{title}」を教材一覧・検索から非表示にします。目次・ページ・設問・添付ファイルは削除されず、受験記録やアンケート回答がある場合もそのまま保持されます。一覧の「状態」絞り込みで「アーカイブ済み」を選ぶといつでも一覧に戻して復元できます。
              </p>
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
                公開中の教材をアーカイブすると、受講者からもこの教材が見えなくなります。
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setArchiveModalOpen(false)}>
                  キャンセル
                </Button>
                <Button variant="danger-ghost" onClick={doArchive} disabled={archiving}>
                  {archiving ? 'アーカイブ中...' : 'アーカイブする'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {deleteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-base font-semibold text-slate-800">教材を削除しますか？</span>
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ×
                </button>
              </div>
              <p className="mb-3 text-sm leading-relaxed text-slate-600">
                「{title}」を完全に削除します。目次・ページ・設問・添付ファイルもすべて削除され、<strong>元に戻せません</strong>。不要になった下書きを完全に消したい場合のみお使いください（公開後の教材は削除できず、アーカイブのみ利用できます）。
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDeleteModalOpen(false)}>
                  キャンセル
                </Button>
                <Button variant="danger-ghost" onClick={doDelete} disabled={deleting}>
                  {deleting ? '削除中...' : '削除する'}
                </Button>
              </div>
            </div>
          </div>
        )}

        <section className="rounded-md border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">目次構造</span>
            <span className="text-xs text-slate-400">
              {chapters.length}章（変更は上の「下書き保存」を押すまで確定しません）
            </span>
          </div>
          {dirty && (
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              保存していない変更があります。ページ編集画面に移動する前に「下書き保存」を押してください。
            </p>
          )}
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
                      {chapter.id !== null && (
                        <button
                          type="button"
                          onClick={() => setSurveyModal({ nodeId: chapter.id, targetLabel: chapter.title || `第${ci + 1}章` })}
                          disabled={dirty}
                          title={dirty ? '保存していない変更があります。先に「下書き保存」を押してください' : undefined}
                          className="flex-shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                        >
                          {surveyFor(chapter.id) ? 'アンケート編集' : 'アンケート設置'}
                        </button>
                      )}
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
                      {chapter.children.map((child, si) =>
                        child.kind === 'page' ? (
                          <div
                            key={child.id ?? `new-${si}`}
                            className="mb-1.5 ml-6 flex items-center gap-2 rounded-md border-l-2 border-slate-200 bg-slate-50 px-2.5 py-1.5"
                          >
                            <TextInput
                              value={child.title}
                              onChange={(e) => renameSection(ci, si, e.target.value)}
                              placeholder="ページタイトルを入力"
                              className="flex-1"
                            />
                            <span className="flex-shrink-0 text-xs text-slate-400">{pageKindLabel(child)}</span>
                            <button
                              type="button"
                              onClick={() => movePageInChapter(ci, si, -1)}
                              disabled={si === 0}
                              title="上へ"
                              className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => movePageInChapter(ci, si, 1)}
                              disabled={si === chapter.children.length - 1}
                              title="下へ"
                              className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                            >
                              ↓
                            </button>
                            {child.id !== null && (
                              <button
                                type="button"
                                onClick={() => goToEditPage(child.id!)}
                                disabled={dirty}
                                title={dirty ? '保存していない変更があります。先に「下書き保存」を押してください' : undefined}
                                className="flex-shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                              >
                                編集する
                              </button>
                            )}
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
                        ) : (
                          <div key={child.id ?? `new-${si}`} className="mb-1.5 ml-6">
                            <div className="flex items-center gap-2 rounded-md border-l-2 border-slate-200 bg-slate-50 px-2.5 py-1.5">
                              <TextInput
                                value={child.title}
                                onChange={(e) => renameSection(ci, si, e.target.value)}
                                placeholder="小見出しのタイトルを入力"
                                className="flex-1"
                              />
                              <span className="flex-shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                                小見出し
                              </span>
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
                            <div className="ml-4 mt-1">
                              {child.children.map((page, pi) => (
                                <div
                                  key={page.id ?? `new-${pi}`}
                                  className="mb-1.5 ml-6 flex items-center gap-2 rounded-md border-l-2 border-slate-200 bg-white px-2.5 py-1.5"
                                >
                                  <TextInput
                                    value={page.title}
                                    onChange={(e) => renamePageInSection(ci, si, pi, e.target.value)}
                                    placeholder="ページタイトルを入力"
                                    className="flex-1"
                                  />
                                  <span className="flex-shrink-0 text-xs text-slate-400">{pageKindLabel(page)}</span>
                                  <button
                                    type="button"
                                    onClick={() => movePageInSection(ci, si, pi, -1)}
                                    disabled={pi === 0}
                                    title="上へ"
                                    className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => movePageInSection(ci, si, pi, 1)}
                                    disabled={pi === child.children.length - 1}
                                    title="下へ"
                                    className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30"
                                  >
                                    ↓
                                  </button>
                                  {page.id !== null && (
                                    <button
                                      type="button"
                                      onClick={() => goToEditPage(page.id!)}
                                      disabled={dirty}
                                      title={dirty ? '保存していない変更があります。先に「下書き保存」を押してください' : undefined}
                                      className="flex-shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                                    >
                                      編集する
                                    </button>
                                  )}
                                  {pendingDelete === `page-in-section:${ci}:${si}:${pi}` ? (
                                    <span className="flex flex-shrink-0 items-center gap-1 text-xs">
                                      本当に削除？
                                      <button
                                        type="button"
                                        onClick={() => deletePageInSection(ci, si, pi)}
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
                                      onClick={() => setPendingDelete(`page-in-section:${ci}:${si}:${pi}`)}
                                      className="flex-shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                                    >
                                      削除
                                    </button>
                                  )}
                                </div>
                              ))}
                              {child.id !== null && (
                                <button
                                  type="button"
                                  onClick={() => goToNewPage(child.id!)}
                                  disabled={dirty}
                                  title={dirty ? '保存していない変更があります。先に「下書き保存」を押してください' : undefined}
                                  className="ml-6 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                                >
                                  + ページを追加
                                </button>
                              )}
                            </div>
                          </div>
                        ),
                      )}
                      <div className="mt-1.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => addSection(ci)}
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          + 小見出しを追加
                        </button>
                        {chapter.id !== null && (
                          <button
                            type="button"
                            onClick={() => goToNewPage(chapter.id!)}
                            disabled={dirty}
                            title={dirty ? '保存していない変更があります。先に「下書き保存」を押してください' : undefined}
                            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                          >
                            + ページを追加
                          </button>
                        )}
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

        {activeTab === 'questions' && (
          <section className="rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-700">問題一覧</span>
            </div>
            <div className="p-4">
              <p className="mb-3 text-xs text-slate-400">
                この教材に含まれる全ページの設問を一覧表示します。手動採点で採点待ちが多い設問、正答率が低い設問ほど上に並びます。「詳細を見る」で回答の傾向を確認できます。
              </p>
              {questionsSummaryLoading && <p className="text-sm text-slate-400">読み込み中...</p>}
              {!questionsSummaryLoading && questionSummaryItems.length === 0 && (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                  まだ設問がありません。
                </p>
              )}
              {!questionsSummaryLoading && questionSummaryItems.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                        <th className="px-3 py-2 font-semibold">ページ</th>
                        <th className="w-24 px-3 py-2 font-semibold">種別</th>
                        <th className="w-28 px-3 py-2 font-semibold">採点方式</th>
                        <th className="w-28 px-3 py-2 font-semibold">状況</th>
                        <th className="px-3 py-2 font-semibold">設問</th>
                        <th className="w-28 px-3 py-2 font-semibold"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {questionSummaryItems.map((item) => (
                        <tr key={item.question_id} className="border-b border-slate-100 align-top last:border-0">
                          <td className="px-3 py-2 text-slate-600">{item.node_path}</td>
                          <td className="px-3 py-2 text-slate-500">{questionTypeLabel(item.type)}</td>
                          <td className="px-3 py-2 text-slate-500">
                            {item.grading_mode === 'manual' ? '手動採点' : item.grading_mode === 'ai' ? 'AI自動採点' : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {item.total_answers === 0 ? (
                              <span className="text-xs text-slate-400">回答なし</span>
                            ) : item.grading_mode === 'manual' && item.pending_count > 0 ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                採点待ち{item.pending_count}件
                              </span>
                            ) : item.accuracy_pct !== null ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                                正答率{item.accuracy_pct}%
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{item.prompt}</td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              disabled
                              title="準備中（S-19実装後に有効化）"
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-400 disabled:cursor-not-allowed"
                            >
                              詳細を見る
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
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
              {savedId !== null && <AttachmentList attachments={attachments} isLoading={attachmentsLoading} />}
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

      {surveyModal && savedId !== null && (
        <SurveyEditModal
          materialId={savedId}
          nodeId={surveyModal.nodeId}
          targetLabel={surveyModal.targetLabel}
          existing={surveyFor(surveyModal.nodeId)}
          onClose={() => setSurveyModal(null)}
          onSaved={() => mutateSurveys()}
        />
      )}
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
