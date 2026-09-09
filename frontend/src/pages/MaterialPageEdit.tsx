import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import AttachmentList from '../components/material/AttachmentList'
import PageContentFields from '../components/material/PageContentFields'
import Button from '../components/ui/Button'
import TextInput from '../components/ui/TextInput'
import Toast from '../components/ui/Toast'
import { useMaterial } from '../hooks/useMaterial'
import { useMaterialAttachments } from '../hooks/useMaterialAttachments'
import { useSaveShortcut } from '../hooks/useSaveShortcut'
import { addLinkAttachment, deleteAttachment, uploadFileAttachment } from '../lib/attachmentActions'
import { ApiError, apiFetch, apiFetchText } from '../lib/api'
import { buildMaterialSource } from '../lib/materialSource'
import type { EditableNode } from '../lib/materialSource'
import { findNode, insertPageInTree, replacePageInTree, toEditableChapters } from '../lib/materialTree'
import { validatePageContent } from '../lib/pageValidation'
import type { Material, Question } from '../types'

// 新規ページ作成中、まだノードが存在せずA-27/A-29を呼べない添付ファイル・リンクを
// ローカルに保持しておくための型。保存時にページ作成後まとめて登録する
type PendingAttachment =
  | { key: string; kind: 'file'; file: File }
  | { key: string; kind: 'link'; url: string }

// poolMembershipでチェックされた設問のうち、保存済み（id !== null）のものだけを対象に
// pool_group（DB上はpool_group_id、自己参照FK）を実IDへ解決する。2問未満しか対象が
// 無い場合はプールを組めないためすべてnullに戻す。未保存の設問は次回保存後に選択できる。
function resolvePoolGroups(questions: Question[], poolMembership: boolean[], poolMode: boolean): Question[] {
  if (!poolMode) return questions.map((q) => (q.pool_group === null ? q : { ...q, pool_group: null }))
  const memberIds = questions
    .map((q, i) => (poolMembership[i] && q.id !== null ? q.id : null))
    .filter((id): id is number => id !== null)
  if (memberIds.length < 2) return questions.map((q) => (q.pool_group === null ? q : { ...q, pool_group: null }))
  const representativeId = Math.min(...memberIds)
  const memberIdSet = new Set(memberIds)
  return questions.map((q) => ({ ...q, pool_group: q.id !== null && memberIdSet.has(q.id) ? representativeId : null }))
}

// S-17 教材編集：ページ編集（詳細設計書10.16節）。説明文編集・添付ファイル・設問編集
// （単一選択・複数選択・並び替え・記述式・コード記述式・スコア記録の6種）まで実装済み。保存はS-05と同じくA-20（PUT /source）の
// 全置換で、他ページの内容（body/questions）はtocから素通りさせて一緒に送る。
export default function MaterialPageEdit() {
  const { projectId, materialId, nodeId } = useParams<{
    projectId: string
    materialId: string
    nodeId: string
  }>()
  const [searchParams] = useSearchParams()
  const parentNodeId = Number(searchParams.get('parentNodeId'))
  const navigate = useNavigate()
  const isNew = nodeId === 'new'

  const { material, isLoading, error: materialError } = useMaterial(Number(materialId))
  const {
    attachments,
    isLoading: attachmentsLoading,
    mutate: mutateAttachments,
  } = useMaterialAttachments(isNew ? null : Number(materialId), isNew ? undefined : Number(nodeId))

  const [title, setTitle] = useState('')
  const [includeExplanation, setIncludeExplanation] = useState(true)
  const [includeQuiz, setIncludeQuiz] = useState(false)
  const [format, setFormat] = useState<'markdown' | 'html'>('markdown')
  const [body, setBody] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [quizMode, setQuizMode] = useState<'all' | 'pool'>('all')
  const [poolDrawCount, setPoolDrawCount] = useState<number | null>(null)
  // 出題プールに含めるかどうかの編集中フラグ（questionsと同じ添字で対応）。
  // pool_group_idは「保存済みの設問の実IDを指す自己参照FK」のため、保存前の画面上では
  // 実IDを直接編集させず、この真偽値だけを管理し、保存直前（save内）に実IDへ解決する。
  const [poolMembership, setPoolMembership] = useState<boolean[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Ctrl+Sでこのページに留まる保存の完了通知（2026-09-09、ユーザー要望。保存ボタンは
  // 保存後に目次へ移動してしまうため見えないが、Ctrl+Sはこの画面に留まるので表示できる）
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])

  useEffect(() => {
    if (!material || initialized) return
    if (!isNew) {
      const tree = toEditableChapters(material.toc ?? [])
      const node = findNode(tree, Number(nodeId))
      if (node && node.kind === 'page') {
        setTitle(node.title)
        setIncludeExplanation(!!node.body)
        setIncludeQuiz((node.questions ?? []).length > 0)
        setFormat(node.format ?? 'markdown')
        setBody(node.body ?? '')
        setQuestions(node.questions ?? [])
        setQuizMode(node.quizMode ?? 'all')
        setPoolDrawCount(node.poolDrawCount ?? null)
        setPoolMembership((node.questions ?? []).map((q) => q.pool_group !== null))
      }
    }
    setInitialized(true)
  }, [material, initialized, isNew, nodeId])

  // 保存完了メッセージは一定時間で消す（MaterialEdit.tsxと同じパターン）
  useEffect(() => {
    if (!savedMessage) return
    const timer = setTimeout(() => setSavedMessage(null), 3000)
    return () => clearTimeout(timer)
  }, [savedMessage])

  const backToStructure = () => navigate(`/projects/${projectId}/materials/${materialId}/edit`)

  // navigateAfter=true（保存ボタン既定）は保存後に目次へ戻る。navigateAfter=false（Ctrl+S）は
  // 目次へ戻らずこのページに留まる。新規ページの場合は「留まる」を選んでも、そのままでは
  // node_idがまだ'new'のためこのURLで再保存すると重複作成されてしまうので、実際に採番された
  // node_idの編集URLへreplaceで置き換える（画面上は同じページに留まったまま。2026-09-09、
  // 「保存＝目次に戻る」が固定でCtrl+Sの動作として不自然というフィードバックを受け対応）。
  const save = async (navigateAfter = true) => {
    setError(null)
    const validationError = validatePageContent({
      title,
      includeExplanation,
      includeQuiz,
      body,
      questions,
      quizMode,
      poolDrawCount,
    })
    if (validationError) {
      setError(validationError)
      return
    }
    if (!material) return
    setSaving(true)
    try {
      const resolvedQuestions = resolvePoolGroups(questions, poolMembership, includeQuiz && quizMode === 'pool')
      const page: EditableNode = {
        id: isNew ? null : Number(nodeId),
        title,
        kind: 'page',
        children: [],
        body: includeExplanation ? body : null,
        format,
        quizMode: includeQuiz ? quizMode : 'all',
        poolDrawCount: includeQuiz && quizMode === 'pool' ? poolDrawCount : null,
        questions: includeQuiz ? resolvedQuestions : [],
      }
      const tree = toEditableChapters(material.toc ?? [])
      const updatedTree = isNew
        ? insertPageInTree(tree, parentNodeId, page)
        : replacePageInTree(tree, Number(nodeId), page)
      const source = buildMaterialSource(material, updatedTree)
      await apiFetchText(`/api/materials/${materialId}/source`, source)
      // 目次へ移動する場合はこの画面がすぐ消えるため表示されないが、留まる場合（Ctrl+S）に
      // 見えるよう常に設定しておく（2026-09-09、ユーザー要望）
      setSavedMessage('保存しました')

      if (isNew) {
        // 新規ページ保存後は必ず、実際に採番されたnode_idを取得する。理由は2つ：
        // (1) 保存前に追加していた添付ファイル・リンクをこのタイミングで登録するため
        //     （保存するまでnode_idが存在せずA-27/A-29を呼べない）。
        // (2) このページに留まる場合（navigateAfter=false）でも、URLはまだnode_id='new'の
        //     ままなので、実際のnode_idの編集URLへ置き換える必要があるため（このURLのままだと
        //     次の保存でまた新規ページとして重複作成されてしまう）。
        const freshMaterial = await apiFetch<Material>(`/api/materials/${materialId}`)
        const freshTree = toEditableChapters(freshMaterial.toc ?? [])
        const parent = findNode(freshTree, parentNodeId)
        const newPage = parent?.children.find((c) => c.kind === 'page' && c.title === title)
        if (!newPage) {
          setError('ページは保存されましたが、保存後の状態取得に失敗しました。目次から開き直してご確認ください。')
          backToStructure()
          return
        }
        if (pendingAttachments.length > 0) {
          try {
            for (const pending of pendingAttachments) {
              if (pending.kind === 'file') {
                await uploadFileAttachment(Number(materialId), newPage.id!, pending.file)
              } else {
                await addLinkAttachment(Number(materialId), newPage.id!, pending.url)
              }
            }
          } catch {
            setError('ページは保存されましたが、添付ファイル・リンクの登録に失敗しました。ページ編集画面から改めて追加してください。')
            backToStructure()
            return
          }
        }
        if (navigateAfter) {
          backToStructure()
        } else {
          navigate(`/projects/${projectId}/materials/${materialId}/pages/${newPage.id}/edit`, { replace: true })
        }
      } else if (navigateAfter) {
        backToStructure()
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // Ctrl+S/Cmd+Sで保存できるようにする（2026-09-09、ユーザー要望）
  useSaveShortcut(() => save(false), !saving)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (isNew) {
      setPendingAttachments((prev) => [...prev, { key: crypto.randomUUID(), kind: 'file', file }])
      return
    }
    setAttachmentError(null)
    setUploading(true)
    try {
      await uploadFileAttachment(Number(materialId), Number(nodeId), file)
      await mutateAttachments()
    } catch (err) {
      setAttachmentError(err instanceof ApiError ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  const handleAddLink = async () => {
    if (!linkUrl.trim()) return
    if (isNew) {
      setPendingAttachments((prev) => [...prev, { key: crypto.randomUUID(), kind: 'link', url: linkUrl.trim() }])
      setLinkUrl('')
      return
    }
    setAttachmentError(null)
    try {
      await addLinkAttachment(Number(materialId), Number(nodeId), linkUrl.trim())
      setLinkUrl('')
      await mutateAttachments()
    } catch (err) {
      setAttachmentError(err instanceof ApiError ? err.message : '追加に失敗しました')
    }
  }

  const handleRemovePending = (key: string) => {
    setPendingAttachments((prev) => prev.filter((p) => p.key !== key))
  }

  const handleDeleteAttachment = async (attachmentId: number) => {
    if (isNew) return
    setAttachmentError(null)
    try {
      await deleteAttachment(Number(materialId), attachmentId)
      await mutateAttachments()
    } catch (err) {
      setAttachmentError(err instanceof ApiError ? err.message : '削除に失敗しました')
    }
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (materialError) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="ページ編集" />
        <div className="px-8 py-6">
          <Link to={`/projects/${projectId}/materials/${materialId}/edit`} className="text-blue-800 hover:underline">
            ← 目次編集に戻る
          </Link>
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            教材を取得できませんでした。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={`ページ編集${title ? ` — ${title}` : ''}`} />
      <div className="px-8 py-6">
        <p className="mb-4">
          <Link to={`/projects/${projectId}/materials/${materialId}/edit`} className="text-blue-800 hover:underline">
            ← 目次編集に戻る
          </Link>
        </p>

        {savedMessage && <Toast message={savedMessage} />}

        {error && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <PageContentFields
          materialId={Number(materialId)}
          title={title}
          onTitleChange={setTitle}
          includeExplanation={includeExplanation}
          onIncludeExplanationChange={setIncludeExplanation}
          includeQuiz={includeQuiz}
          onIncludeQuizChange={setIncludeQuiz}
          format={format}
          onFormatChange={setFormat}
          body={body}
          onBodyChange={setBody}
          questions={questions}
          onQuestionsChange={setQuestions}
          quizMode={quizMode}
          onQuizModeChange={setQuizMode}
          poolDrawCount={poolDrawCount}
          onPoolDrawCountChange={setPoolDrawCount}
          poolMembership={poolMembership}
          onPoolMembershipChange={setPoolMembership}
          titleInputId="p-title"
        />

        <section className="mb-6 rounded-md border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">このページの添付ファイル・リンク</span>
            <span className="text-xs text-slate-400">
              {isNew ? pendingAttachments.length : attachments.length}件
            </span>
          </div>
          <div className="p-4">
            {attachmentError && (
              <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {attachmentError}
              </p>
            )}
            {isNew ? (
              <>
                {pendingAttachments.length > 0 && (
                  <ul className="mb-3 flex flex-col gap-1.5">
                    {pendingAttachments.map((p) => (
                      <li
                        key={p.key}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
                      >
                        <span className="truncate">
                          {p.kind === 'file' ? p.file.name : p.url}
                          <span className="ml-1.5 text-[10px] text-amber-600">（保存すると登録されます）</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemovePending(p.key)}
                          className="flex-shrink-0 text-slate-400 hover:text-red-600"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mb-2 text-xs text-slate-400">
                  ここで追加したファイル・リンクは、保存したときにまとめて登録されます。
                </p>
              </>
            ) : (
              <AttachmentList
                attachments={attachments}
                isLoading={attachmentsLoading}
                onDelete={handleDeleteAttachment}
              />
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="flex h-9 min-w-[160px] flex-1 cursor-pointer items-center justify-center rounded-md border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                {uploading ? 'アップロード中...' : 'ファイルを選択'}
                <input type="file" className="hidden" onChange={handleFileSelect} disabled={uploading} />
              </label>
              <TextInput
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="または外部リンクを追加 https://..."
                className="min-w-[200px] flex-1"
              />
              <Button variant="secondary" onClick={handleAddLink} disabled={!linkUrl.trim()}>
                追加
              </Button>
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => save()} disabled={saving}>
            保存して目次に戻る
          </Button>
          <span className="text-xs text-slate-400">Ctrl+S（Macはcmd+S）でこのページに留まったまま保存できます</span>
        </div>
      </div>
    </div>
  )
}
