import MarkdownHtmlEditor from '../ui/MarkdownHtmlEditor'
import TextInput from '../ui/TextInput'
import QuestionEditCard from './QuestionEditCard'
import { emptyQuestionForType } from '../../lib/questionDefaults'
import type { Question } from '../../types'

export interface PageContentFieldsProps {
  // 保存前（materialId未確定）の新規ページ編集ではnull。MarkdownHtmlEditorのプレビュー可否に使う。
  materialId: number | null
  title: string
  onTitleChange: (v: string) => void
  includeExplanation: boolean
  onIncludeExplanationChange: (v: boolean) => void
  includeQuiz: boolean
  onIncludeQuizChange: (v: boolean) => void
  format: 'markdown' | 'html'
  onFormatChange: (f: 'markdown' | 'html') => void
  body: string
  onBodyChange: (v: string) => void
  questions: Question[]
  onQuestionsChange: (qs: Question[]) => void
  quizMode: 'all' | 'pool'
  onQuizModeChange: (m: 'all' | 'pool') => void
  poolDrawCount: number | null
  onPoolDrawCountChange: (n: number | null) => void
  poolMembership: boolean[]
  onPoolMembershipChange: (m: boolean[]) => void
  titleInputId?: string
}

// ページ（タイトル・説明文・問題）の入力フィールド一式。MaterialPageEdit.tsx（S-17、既存ページの
// 編集画面）とInlinePageEditor.tsx（S-05目次編集画面内でのページ新規作成）の両方から共通で使う
// （2026-09-09）。状態はすべて呼び出し側が持つ（controlled）。添付ファイルは呼び出し側ごとに
// 要件が異なるため含めない（新規ページには実IDが無く添付ファイルを登録できないため）。
export default function PageContentFields({
  materialId,
  title,
  onTitleChange,
  includeExplanation,
  onIncludeExplanationChange,
  includeQuiz,
  onIncludeQuizChange,
  format,
  onFormatChange,
  body,
  onBodyChange,
  questions,
  onQuestionsChange,
  quizMode,
  onQuizModeChange,
  poolDrawCount,
  onPoolDrawCountChange,
  poolMembership,
  onPoolMembershipChange,
  titleInputId = 'page-title',
}: PageContentFieldsProps) {
  const addQuestion = () => {
    onQuestionsChange([...questions, emptyQuestionForType('single')])
    onPoolMembershipChange([...poolMembership, false])
  }
  const updateQuestion = (i: number, q: Question) =>
    onQuestionsChange(questions.map((old, idx) => (idx === i ? q : old)))
  const deleteQuestion = (i: number) => {
    onQuestionsChange(questions.filter((_, idx) => idx !== i))
    onPoolMembershipChange(poolMembership.filter((_, idx) => idx !== i))
  }
  const togglePoolMembership = (i: number) =>
    onPoolMembershipChange(poolMembership.map((v, idx) => (idx === i ? !v : v)))

  return (
    <>
      <div className="mb-4 flex max-w-md flex-col gap-1">
        <label htmlFor={titleInputId} className="text-xs font-semibold text-slate-500">
          ページタイトル
        </label>
        <TextInput id={titleInputId} value={title} onChange={(e) => onTitleChange(e.target.value)} maxLength={200} />
      </div>

      <div className="mb-5 flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">このページの構成</label>
        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3.5 py-2 text-xs">
            <input
              type="checkbox"
              checked={includeExplanation}
              onChange={(e) => onIncludeExplanationChange(e.target.checked)}
            />
            説明文を含める
          </label>
          <label className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3.5 py-2 text-xs">
            <input type="checkbox" checked={includeQuiz} onChange={(e) => onIncludeQuizChange(e.target.checked)} />
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
              materialId={materialId}
              format={format}
              onFormatChange={onFormatChange}
              body={body}
              onBodyChange={onBodyChange}
            />
          </div>
        </section>
      )}

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
                  <input type="radio" checked={quizMode === 'all'} onChange={() => onQuizModeChange('all')} />
                  すべて出題
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" checked={quizMode === 'pool'} onChange={() => onQuizModeChange('pool')} />
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
                      onChange={(e) => onPoolDrawCountChange(e.target.value ? Number(e.target.value) : null)}
                      className="w-16 rounded-md border border-slate-300 px-2 py-1"
                    />
                    問
                  </label>
                )}
              </div>
              <span className="text-xs text-slate-400">
                「プールからランダムに抽出」を選ぶと、この設問一覧から毎回指定した数だけランダムに出題します。
              </span>

              {quizMode === 'pool' && (
                <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <span className="text-xs font-semibold text-slate-500">プールに含める設問</span>
                  {questions.length === 0 ? (
                    <span className="text-xs text-slate-400">設問を追加してください。</span>
                  ) : (
                    questions.map((q, i) => (
                      <label
                        key={i}
                        className={`flex items-center gap-2 text-xs ${
                          q.id === null ? 'text-slate-300' : 'text-slate-600'
                        }`}
                        title={q.id === null ? '保存後にプール対象へ選択できます' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={!!poolMembership[i]}
                          disabled={q.id === null}
                          onChange={() => togglePoolMembership(i)}
                        />
                        設問{i + 1}: {q.prompt.trim() || '（設問文未入力）'}
                      </label>
                    ))
                  )}
                  <span className="text-xs text-slate-400">
                    チェックしなかった設問は毎回固定で出題されます（プールの抽選対象外）。2問以上チェックしないとプールは組めません。新規追加した設問は保存後に選択できます。
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  )
}
