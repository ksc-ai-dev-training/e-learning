import { useEffect, useRef, useState } from 'react'
import Button from '../ui/Button'
import TextInput from '../ui/TextInput'
import PageContentFields from './PageContentFields'
import type { EditableNode, PendingAttachment } from '../../lib/materialSource'
import { validatePageContent } from '../../lib/pageValidation'
import type { Question } from '../../types'

interface InlinePageEditorProps {
  // 教材がまだ保存されていない新規作成中はnull（PageContentFieldsへそのまま渡す）
  materialId: number | null
  // 教材設定タブで編集中（未保存分含む）の採点方式既定値。PageContentFieldsへそのまま渡す
  materialGradingMode: 'ai' | 'manual'
  // 指定時は既存の（まだサーバー未保存の）ページを編集するモードになり、フィールドの初期値を
  // このページの内容で埋める。未指定なら空の新規ページとして開始する（2026-09-09）。
  initialPage?: EditableNode
  confirmLabel?: string
  onConfirm: (page: EditableNode) => void
  onCancel: () => void
}

// S-05目次編集画面の中で、ページの説明文・問題をその場（インライン）で入力するためのパネル。
// 画面遷移・サーバー保存は一切行わず、確定時にEditableNodeを1つ組み立てて呼び出し元へ渡すだけ
// （2026-09-09。「タイトル→章作成→ページ作成→保存」を最後の1回の保存で完結させたいという
// 要望への対応）。新規ページ作成にも、まだサーバー未保存のページの再編集にも両方使う。
// 添付ファイルは実際のページIDが無いと登録できないため、ここではpendingAttachmentsとして
// EditableNode側に保持するだけにとどめ（MaterialPageEdit.tsxの新規ページと同じ仕組み）、
// 実際のA-27/A-29登録は「下書き保存」後、MaterialEdit.tsx側でページの実idが判明してから
// まとめて行う（2026-09-24、目次画面から添付できない不便さの解消）。
export default function InlinePageEditor({
  materialId,
  materialGradingMode,
  initialPage,
  confirmLabel = 'このページを追加する',
  onConfirm,
  onCancel,
}: InlinePageEditorProps) {
  const [title, setTitle] = useState(initialPage?.title ?? '')
  const [includeExplanation, setIncludeExplanation] = useState(initialPage ? !!initialPage.body : true)
  const [includeQuiz, setIncludeQuiz] = useState(initialPage ? (initialPage.questions?.length ?? 0) > 0 : false)
  const [format, setFormat] = useState<'markdown' | 'html'>(initialPage?.format ?? 'markdown')
  const [body, setBody] = useState(initialPage?.body ?? '')
  const [questions, setQuestions] = useState<Question[]>(initialPage?.questions ?? [])
  const [quizMode, setQuizMode] = useState<'all' | 'pool'>(initialPage?.quizMode ?? 'all')
  const [poolDrawCount, setPoolDrawCount] = useState<number | null>(initialPage?.poolDrawCount ?? null)
  const [poolMembership, setPoolMembership] = useState<boolean[]>(
    initialPage?.questions?.map((q) => q.pool_group !== null) ?? [],
  )
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>(
    initialPage?.pendingAttachments ?? [],
  )
  const [expandedPendingKeys, setExpandedPendingKeys] = useState<Set<string>>(new Set())
  const [linkUrl, setLinkUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  // 設問を複数追加した長いページで「このページを追加する」（一番下）を押したときにブロックされると、
  // エラー文言はこのパネルの一番上に出るため、スクロールが下にあると表示に気づけない
  // （2026-09-16、ユーザー報告）。エラーが出た瞬間にその位置まで自動でスクロールする。
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const previewUrl = file.type === 'application/pdf' ? URL.createObjectURL(file) : null
    setPendingAttachments((prev) => [...prev, { key: crypto.randomUUID(), kind: 'file', file, previewUrl }])
  }

  const handleAddLink = () => {
    if (!linkUrl.trim()) return
    setPendingAttachments((prev) => [...prev, { key: crypto.randomUUID(), kind: 'link', url: linkUrl.trim() }])
    setLinkUrl('')
  }

  const handleRemovePending = (key: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((p) => p.key === key)
      if (target?.kind === 'file' && target.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((p) => p.key !== key)
    })
    setExpandedPendingKeys((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const togglePendingPreview = (key: string) => {
    setExpandedPendingKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const confirm = () => {
    const validationError = validatePageContent({
      title,
      includeExplanation,
      includeQuiz,
      body,
      questions,
      quizMode,
      poolDrawCount,
      materialGradingMode,
    })
    if (validationError) {
      setError(validationError)
      return
    }
    // 出題プールのグループ化は保存済み（実ID）の設問同士でしか組めない（PageContentFields側も
    // q.id===nullの間はチェック自体をdisabledにしている）。ここで扱うページの設問はすべて
    // id=nullなので、pool_groupは常にnullのまま送る。
    const page: EditableNode = {
      id: initialPage?.id ?? null,
      title,
      kind: 'page',
      children: [],
      body: includeExplanation ? body : null,
      format,
      quizMode: includeQuiz ? quizMode : 'all',
      poolDrawCount: includeQuiz && quizMode === 'pool' ? poolDrawCount : null,
      questions: includeQuiz ? questions.map((q) => ({ ...q, pool_group: null })) : [],
      pendingAttachments,
    }
    onConfirm(page)
  }

  return (
    <div className="my-2 rounded-md border-2 border-blue-600 bg-blue-50 p-3.5">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-bold text-blue-800">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {initialPage ? 'ページを編集' : '新しいページを作成'}
      </div>

      {error && (
        <p ref={errorRef} className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      <PageContentFields
        materialId={materialId}
        materialGradingMode={materialGradingMode}
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
        titleInputId="inline-new-page-title"
      />

      <div className="mb-3 rounded-md border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-600">添付ファイル・リンク</span>
          <span className="text-xs text-slate-400">{pendingAttachments.length}件</span>
        </div>
        {pendingAttachments.length > 0 && (
          <ul className="mb-2 flex flex-col gap-1.5">
            {pendingAttachments.map((p) => (
              <li key={p.key} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {p.kind === 'file' ? p.file.name : p.url}
                    <span className="ml-1.5 text-[10px] text-amber-600">（保存すると登録されます）</span>
                  </span>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {p.kind === 'file' && p.previewUrl && (
                      <button
                        type="button"
                        onClick={() => togglePendingPreview(p.key)}
                        className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-white"
                      >
                        {expandedPendingKeys.has(p.key) ? '閉じる' : 'プレビュー'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemovePending(p.key)}
                      className="text-slate-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  </div>
                </div>
                {p.kind === 'file' && p.previewUrl && expandedPendingKeys.has(p.key) && (
                  <iframe
                    src={p.previewUrl}
                    title={p.file.name}
                    className="mt-2 h-[600px] w-full rounded-md border border-slate-200 bg-white"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <label className="flex h-9 min-w-[140px] flex-1 cursor-pointer items-center justify-center rounded-md border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            ファイルを選択
            <input type="file" className="hidden" onChange={handleFileSelect} />
          </label>
          <TextInput
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="または外部リンクを追加 https://..."
            className="min-w-[180px] flex-1"
          />
          <Button variant="secondary" onClick={handleAddLink} disabled={!linkUrl.trim()}>
            追加
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          ここで追加したファイル・リンクは、このページを保存したときにまとめて登録されます。
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button variant="primary" onClick={confirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
