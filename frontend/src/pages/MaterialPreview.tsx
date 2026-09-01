import { Link, useParams } from 'react-router'
import PageBody from '../components/material/PageBody'
import PageHeader from '../components/layout/PageHeader'
import { useMaterialPreview } from '../hooks/useMaterialPreview'
import type { MaterialNode, Question } from '../types'

const TYPE_LABEL: Record<Question['type'], string> = {
  single: '単一選択',
  multi: '複数選択',
  reorder: '並び替え',
  free_text: '記述式',
  code: 'コード記述式',
  score_log: 'スコア記録',
}

// S-05「プレビュー」ボタン専用の教材全体通し読み画面（詳細設計書10.5節相当）。編集者限定
// （require_material_role('editor')、A-94）。教材全体を一度に確認できるようにする一方、学習者側の
// 受講画面（S-04/S-16）とは分離し、受講せずに教材を読めてしまう抜け道を作らないためのもの
// （ユーザーとの検討により、学習者向けのプレビューは設けない方針とした。2026-09-01）。
export default function MaterialPreview() {
  const { projectId, materialId } = useParams<{ projectId: string; materialId: string }>()
  const { preview, isLoading, error } = useMaterialPreview(materialId ? Number(materialId) : null)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={`プレビュー${preview ? ` — ${preview.title}` : ''}`}
        actions={
          <Link
            to={`/projects/${projectId}/materials/${materialId}/edit`}
            className="text-xs font-semibold text-blue-700 hover:underline"
          >
            ← 編集に戻る
          </Link>
        }
      />
      <div className="mx-auto max-w-3xl px-8 py-6">
        {isLoading && <p className="text-sm text-slate-400">読み込み中...</p>}
        {error && <p className="text-sm text-red-600">教材の取得に失敗しました</p>}
        {preview && (
          <>
            <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              これは編集者向けのプレビューです。設問の正解も含めて全体を確認できます。受講者にはこの画面は表示されません。
            </div>
            {preview.description && <p className="mb-6 text-sm text-slate-600">{preview.description}</p>}
            {preview.toc.length === 0 && (
              <p className="text-sm text-slate-400">まだ章・ページがありません。</p>
            )}
            {preview.toc.map((chapter, i) => (
              <ChapterView key={chapter.id} chapter={chapter} index={i} materialId={preview.id} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function ChapterView({
  chapter,
  index,
  materialId,
}: {
  chapter: MaterialNode
  index: number
  materialId: number
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 border-b border-slate-200 pb-2 text-lg font-bold text-slate-900">
        第{index + 1}章 {chapter.title}
      </h2>
      {chapter.children.map((child) =>
        child.kind === 'section' ? (
          <div key={child.id} className="mb-6 ml-2">
            <h3 className="mb-3 text-sm font-bold text-slate-700">{child.title}</h3>
            <div className="ml-2">
              {child.children.map((page) => (
                <PageView key={page.id} page={page} materialId={materialId} />
              ))}
            </div>
          </div>
        ) : (
          <PageView key={child.id} page={child} materialId={materialId} />
        ),
      )}
    </section>
  )
}

function PageView({ page, materialId }: { page: MaterialNode; materialId: number }) {
  return (
    <div className="mb-8">
      <h4 className="mb-2 text-sm font-semibold text-slate-800">{page.title}</h4>
      {page.body && <PageBody materialId={materialId} body={page.body} format={page.format ?? 'markdown'} />}
      {page.questions.map((q, i) => (
        <QuestionView key={q.id ?? `new-${i}`} question={q} index={i} />
      ))}
    </div>
  )
}

function QuestionView({ question, index }: { question: Question; index: number }) {
  return (
    <div className="mb-3 rounded-md border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">
          問{index + 1}・{TYPE_LABEL[question.type]}
        </span>
        {question.required && <span className="text-[11px] text-slate-400">回答必須</span>}
        {question.is_critical && (
          <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
            ドボン問題
          </span>
        )}
      </div>
      <p className="mb-2 text-sm text-slate-800">{question.prompt}</p>

      {(question.type === 'single' || question.type === 'multi') && question.options && (
        <ul className="flex flex-col gap-1">
          {question.options.map((opt) => {
            const isCorrect = Array.isArray(question.correct_answer)
              ? question.correct_answer.includes(opt)
              : question.correct_answer === opt
            return (
              <li
                key={opt}
                className={`rounded border px-2 py-1 text-xs ${
                  isCorrect ? 'border-green-300 bg-green-50 text-green-800' : 'border-slate-200 text-slate-600'
                }`}
              >
                {isCorrect ? '✓ ' : ''}
                {opt}
              </li>
            )
          })}
        </ul>
      )}

      {question.type === 'reorder' && Array.isArray(question.correct_answer) && (
        <ol className="list-decimal pl-5 text-xs text-slate-700">
          {question.correct_answer.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      )}

      {(question.type === 'free_text' || question.type === 'code') && (
        <div className="text-xs text-slate-500">
          <p>
            <span className="font-semibold text-slate-600">採点基準:</span> {question.scoring_criteria}
          </p>
          {question.type === 'code' && question.code_language && (
            <p>
              <span className="font-semibold text-slate-600">言語:</span> {question.code_language}
            </p>
          )}
        </div>
      )}

      {question.type === 'score_log' && (
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-600">記録単位:</span> {question.score_unit}
        </p>
      )}
    </div>
  )
}
