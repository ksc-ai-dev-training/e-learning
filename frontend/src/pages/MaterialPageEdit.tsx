import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import AttachmentList from '../components/material/AttachmentList'
import QuestionEditCard from '../components/material/QuestionEditCard'
import Button from '../components/ui/Button'
import MarkdownHtmlEditor from '../components/ui/MarkdownHtmlEditor'
import TextInput from '../components/ui/TextInput'
import { useMaterial } from '../hooks/useMaterial'
import { useMaterialAttachments } from '../hooks/useMaterialAttachments'
import { addLinkAttachment, deleteAttachment, uploadFileAttachment } from '../lib/attachmentActions'
import { ApiError, apiFetchText } from '../lib/api'
import { buildMaterialSource } from '../lib/materialSource'
import type { EditableNode } from '../lib/materialSource'
import { findNode, insertPageInTree, replacePageInTree, toEditableChapters } from '../lib/materialTree'
import { emptyQuestionForType } from '../lib/questionDefaults'
import type { Question } from '../types'

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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

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
      }
    }
    setInitialized(true)
  }, [material, initialized, isNew, nodeId])

  const backToStructure = () => navigate(`/projects/${projectId}/materials/${materialId}/edit`)

  const addQuestion = () => setQuestions([...questions, emptyQuestionForType('single')])
  const updateQuestion = (i: number, q: Question) => setQuestions(questions.map((old, idx) => (idx === i ? q : old)))
  const deleteQuestion = (i: number) => setQuestions(questions.filter((_, idx) => idx !== i))

  const validateQuestions = (qs: Question[]): string | null => {
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i]
      if (!q.prompt.trim()) {
        return `設問${i + 1}: 設問文を入力してください`
      }
      if (q.type === 'single' || q.type === 'multi') {
        const options = (q.options ?? []).filter((o) => o.trim())
        if (options.length < 2) {
          return `設問${i + 1}: 選択肢を2つ以上入力してください`
        }
        const hasCorrect =
          q.type === 'multi' ? ((q.correct_answer as string[] | null) ?? []).length > 0 : !!q.correct_answer
        if (!hasCorrect) {
          return `設問${i + 1}: 正解を選んでください`
        }
      }
      if (q.type === 'reorder') {
        const items = ((q.correct_answer as string[] | null) ?? []).filter((v) => v.trim())
        if (items.length < 2) {
          return `設問${i + 1}: 項目を2つ以上入力してください`
        }
      }
      if (q.type === 'free_text' || q.type === 'code') {
        if (!q.scoring_criteria?.trim()) {
          return `設問${i + 1}: AI採点基準を入力してください`
        }
        if (q.type === 'code' && !q.code_language?.trim()) {
          return `設問${i + 1}: 言語ヒントを入力してください`
        }
      }
      if (q.type === 'score_log' && !q.score_unit?.trim()) {
        return `設問${i + 1}: スコアの単位を入力してください`
      }
    }
    return null
  }

  const save = async () => {
    setError(null)
    if (title.trim().length === 0) {
      setError('ページタイトルを入力してください')
      return
    }
    if (!includeExplanation && !includeQuiz) {
      setError('説明文・問題のいずれかを含めてください')
      return
    }
    if (includeExplanation && !body.trim()) {
      setError('説明文を入力してください')
      return
    }
    if (includeQuiz) {
      if (questions.length === 0) {
        setError('問題を1つ以上追加してください')
        return
      }
      const qError = validateQuestions(questions)
      if (qError) {
        setError(qError)
        return
      }
      if (quizMode === 'pool' && (!poolDrawCount || poolDrawCount < 1)) {
        setError('出題プールの抽出数を1以上で入力してください')
        return
      }
    }
    if (!material) return
    setSaving(true)
    try {
      const page: EditableNode = {
        id: isNew ? null : Number(nodeId),
        title,
        kind: 'page',
        children: [],
        body: includeExplanation ? body : null,
        format,
        quizMode: includeQuiz ? quizMode : 'all',
        poolDrawCount: includeQuiz && quizMode === 'pool' ? poolDrawCount : null,
        questions: includeQuiz ? questions : [],
      }
      const tree = toEditableChapters(material.toc ?? [])
      const updatedTree = isNew
        ? insertPageInTree(tree, parentNodeId, page)
        : replacePageInTree(tree, Number(nodeId), page)
      const source = buildMaterialSource(material, updatedTree)
      await apiFetchText(`/api/materials/${materialId}/source`, source)
      backToStructure()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || isNew) return
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
    if (isNew || !linkUrl.trim()) return
    setAttachmentError(null)
    try {
      await addLinkAttachment(Number(materialId), Number(nodeId), linkUrl.trim())
      setLinkUrl('')
      await mutateAttachments()
    } catch (err) {
      setAttachmentError(err instanceof ApiError ? err.message : '追加に失敗しました')
    }
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

        {error && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="mb-4 flex max-w-md flex-col gap-1">
          <label htmlFor="p-title" className="text-xs font-semibold text-slate-500">
            ページタイトル
          </label>
          <TextInput id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>

        <div className="mb-5 flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">このページの構成</label>
          <div className="flex gap-2">
            <label className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3.5 py-2 text-xs">
              <input
                type="checkbox"
                checked={includeExplanation}
                onChange={(e) => setIncludeExplanation(e.target.checked)}
              />
              説明文を含める
            </label>
            <label className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3.5 py-2 text-xs">
              <input type="checkbox" checked={includeQuiz} onChange={(e) => setIncludeQuiz(e.target.checked)} />
              問題を含める
            </label>
          </div>
          <span className="text-xs text-slate-400">
            作成者の判断で自由に組み合わせられます。少なくとも一方は必須です。
          </span>
        </div>

        {includeExplanation && (
          <section className="mb-6 rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-700">説明文</span>
            </div>
            <div className="p-4">
              <MarkdownHtmlEditor
                materialId={Number(materialId)}
                format={format}
                onFormatChange={setFormat}
                body={body}
                onBodyChange={setBody}
              />
            </div>
          </section>
        )}

        <section className="mb-6 rounded-md border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">このページの添付ファイル・リンク</span>
            <span className="text-xs text-slate-400">{attachments.length}件</span>
          </div>
          <div className="p-4">
            {isNew ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                先にこのページを保存してください。保存すると添付ファイル・リンクを追加できます。
              </p>
            ) : (
              <>
                {attachmentError && (
                  <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {attachmentError}
                  </p>
                )}
                <AttachmentList
                  attachments={attachments}
                  isLoading={attachmentsLoading}
                  onDelete={handleDeleteAttachment}
                />
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
              </>
            )}
          </div>
        </section>

        {includeQuiz && (
          <section className="mb-6 rounded-md border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <span className="text-sm font-semibold text-slate-700">問題</span>
            </div>
            <div className="p-4">
              {questions.map((q, i) => (
                <QuestionEditCard
                  key={i}
                  question={q}
                  index={i}
                  onChange={(nq) => updateQuestion(i, nq)}
                  onDelete={() => deleteQuestion(i)}
                />
              ))}
              <button
                type="button"
                onClick={addQuestion}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                + 設問を追加
              </button>

              <div className="mt-4 flex flex-col gap-1 border-t border-slate-200 pt-3">
                <label className="text-xs font-semibold text-slate-500">出題設定</label>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={quizMode === 'all'} onChange={() => setQuizMode('all')} />
                    すべて出題
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={quizMode === 'pool'} onChange={() => setQuizMode('pool')} />
                    プールからランダムに抽出
                  </label>
                  {quizMode === 'pool' && (
                    <label className="flex items-center gap-1">
                      出題数
                      <input
                        type="number"
                        min={1}
                        max={questions.length || undefined}
                        value={poolDrawCount ?? ''}
                        onChange={(e) => setPoolDrawCount(e.target.value ? Number(e.target.value) : null)}
                        className="w-16 rounded-md border border-slate-300 px-2 py-1"
                      />
                      問
                    </label>
                  )}
                </div>
                <span className="text-xs text-slate-400">
                  「プールからランダムに抽出」を選ぶと、この設問一覧から毎回指定した数だけランダムに出題します。
                </span>
              </div>
            </div>
          </section>
        )}

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={saving}>
            このページを保存
          </Button>
        </div>
      </div>
    </div>
  )
}
