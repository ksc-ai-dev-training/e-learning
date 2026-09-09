import { useState } from 'react'
import Button from '../ui/Button'
import PageContentFields from './PageContentFields'
import type { EditableNode } from '../../lib/materialSource'
import { validatePageContent } from '../../lib/pageValidation'
import type { Question } from '../../types'

interface InlinePageEditorProps {
  // 教材がまだ保存されていない新規作成中はnull（PageContentFieldsへそのまま渡す）
  materialId: number | null
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
// 添付ファイルは実際のページIDが無いと登録できないため、このパネルでは扱わない
// （保存後に「編集する」から追加してもらう）。
export default function InlinePageEditor({
  materialId,
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
  const [error, setError] = useState<string | null>(null)

  const confirm = () => {
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
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      <PageContentFields
        materialId={materialId}
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

      <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        添付ファイル・リンクはこの画面では追加できません。保存後、目次から「編集する」を開いて追加してください。
      </p>

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
