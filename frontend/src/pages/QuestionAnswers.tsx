import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Panel from '../components/ui/Panel'
import { useQuestionAnswers } from '../hooks/useQuestionAnswers'
import { questionTypeLabel } from '../lib/questionDefaults'
import { formatDateJst } from '../lib/datetime'
import type { QuestionAnswersResponse } from '../types'

type Item = QuestionAnswersResponse['items'][number]

// S-19 設問別の回答・結果一覧。設問ごとの回答傾向を確認する読み取り専用の診断ビュー。
// S-05「問題一覧」タブの「詳細を見る」から開く。手動採点の処理はS-20（採点）に一本化している。
export default function QuestionAnswers() {
  const { questionId } = useParams<{ questionId: string }>()
  const { data, error, isLoading } = useQuestionAnswers(questionId ? Number(questionId) : null)

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="設問別の回答・結果一覧" />
        <div className="px-8 py-6">
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            設問の回答一覧を取得できませんでした。
          </p>
        </div>
      </div>
    )
  }

  const { question, items } = data

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="設問別の回答・結果一覧" />
      <div className="px-8 py-6">
        <p className="mb-4">
          <Link
            to={`/projects/${question.project_id}/materials/${question.material_id}/edit?tab=questions`}
            className="text-blue-800 hover:underline"
          >
            ← 問題一覧に戻る
          </Link>
        </p>
        <p className="mb-1 text-xs text-slate-400">
          {question.material_title} ／ {question.node_path}
        </p>
        <p className="mb-4 max-w-3xl text-sm text-slate-500">
          この画面は<strong>設問ごとの回答傾向を確認し、設問を見直すかどうかの判断材料にするための読み取り専用ビュー</strong>
          です。氏名付きで全受講者の回答を確認できます。手動採点の未採点分を実際に処理する場合はサイドバーの「採点」を使用してください。
        </p>

        <Panel title={`設問「${question.prompt}」`} count={<QuestionSummary question={question} items={items} />}>
          <div className="p-4">
            {(question.type === 'single' || question.type === 'multi' || question.type === 'reorder') && (
              <ChoiceDistribution question={question} items={items} />
            )}
            {(question.type === 'free_text' || question.type === 'code') && (
              <FreeTextAnswers question={question} items={items} />
            )}
            {question.type === 'score_log' && <ScoreLogAnswers question={question} items={items} />}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function QuestionSummary({ question, items }: { question: QuestionAnswersResponse['question']; items: Item[] }) {
  const typeLabel = questionTypeLabel(question.type)
  if (question.type === 'score_log') {
    return <>{typeLabel} ／ 記録者{new Set(items.map((i) => i.user_id)).size}名</>
  }
  if (question.type === 'free_text' || question.type === 'code') {
    const gradingLabel = question.grading_mode === 'manual' ? '手動採点' : 'AI自動採点'
    const gradedCount = items.filter((i) => i.is_correct !== null).length
    const correctCount = items.filter((i) => i.is_correct === true).length
    return (
      <>
        {typeLabel} ／ 採点方式: {gradingLabel} ／{' '}
        {gradedCount > 0 ? `正答率 ${Math.round((correctCount / gradedCount) * 100)}%（${correctCount}/${gradedCount}件、回答済み）` : `回答${items.length}件`}
      </>
    )
  }
  const correctCount = items.filter((i) => i.is_correct === true).length
  const rate = items.length > 0 ? Math.round((correctCount / items.length) * 100) : 0
  return (
    <>
      {typeLabel} ／ 正答率 {rate}%（回答{items.length}件）
    </>
  )
}

function responseLabel(response: unknown): string {
  if (Array.isArray(response)) return response.join('、')
  if (response === null || response === undefined) return '—'
  return String(response)
}

function ChoiceDistribution({
  question,
  items,
}: {
  question: QuestionAnswersResponse['question']
  items: Item[]
}) {
  const correctAnswer = question.correct_answer

  const options = useMemo(() => question.options ?? [], [question.options])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const opt of options) map.set(opt, 0)
    for (const item of items) {
      const values = Array.isArray(item.response) ? item.response : item.response !== null ? [item.response] : []
      for (const v of values) {
        map.set(String(v), (map.get(String(v)) ?? 0) + 1)
      }
    }
    return map
  }, [options, items])

  const isCorrectOption = (opt: string) => {
    if (Array.isArray(correctAnswer)) return correctAnswer.includes(opt)
    return correctAnswer === opt
  }

  if (question.type === 'reorder') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-400">
              <th className="px-3 py-2 text-left font-normal">受講者</th>
              <th className="px-3 py-2 text-left font-normal">回答した順序</th>
              <th className="w-20 px-3 py-2 text-left font-normal">正誤</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="whitespace-nowrap px-3 py-2">{item.user_name}</td>
                <td className="px-3 py-2 text-slate-700">{responseLabel(item.response)}</td>
                <td className="px-3 py-2">
                  <CorrectBadge isCorrect={item.is_correct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const total = items.length
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 text-xs text-slate-400">
          <th className="px-3 py-2 text-left font-normal">選択肢</th>
          <th className="w-20 px-3 py-2 text-left font-normal">正解</th>
          <th className="w-24 px-3 py-2 text-left font-normal">回答数</th>
          <th className="w-20 px-3 py-2 text-left font-normal">割合</th>
        </tr>
      </thead>
      <tbody>
        {options.map((opt) => {
          const count = counts.get(opt) ?? 0
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <tr key={opt} className="border-b border-slate-50">
              <td className="px-3 py-2 text-slate-700">{opt}</td>
              <td className="px-3 py-2">
                {isCorrectOption(opt) && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    正解
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-slate-700">{count}人</td>
              <td className="px-3 py-2 text-slate-700">{pct}%</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function FreeTextAnswers({
  question,
  items,
}: {
  question: QuestionAnswersResponse['question']
  items: Item[]
}) {
  const isManual = question.grading_mode === 'manual'
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 text-xs text-slate-400">
          <th className="px-3 py-2 text-left font-normal">受講者</th>
          <th className="px-3 py-2 text-left font-normal">回答内容</th>
          <th className="w-24 px-3 py-2 text-left font-normal">{isManual ? '採点' : 'AI採点'}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i} className="border-b border-slate-50">
            <td className="whitespace-nowrap px-3 py-2">{item.user_name}</td>
            <td className="max-w-[360px] whitespace-normal px-3 py-2 text-slate-700">{responseLabel(item.response)}</td>
            <td className="px-3 py-2">
              {item.is_correct === null ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
                  未採点
                </span>
              ) : (
                <CorrectBadge isCorrect={item.is_correct} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ScoreLogAnswers({
  question,
  items,
}: {
  question: QuestionAnswersResponse['question']
  items: Item[]
}) {
  const byUser = useMemo(() => {
    const map = new Map<number, { userName: string; scores: { score: number; submittedAt: string }[] }>()
    for (const item of items) {
      const score = (item.response as { score?: number } | null)?.score
      if (typeof score !== 'number') continue
      if (!map.has(item.user_id)) map.set(item.user_id, { userName: item.user_name, scores: [] })
      map.get(item.user_id)!.scores.push({ score, submittedAt: item.submitted_at })
    }
    for (const entry of map.values()) {
      entry.scores.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    }
    return Array.from(map.values())
  }, [items])

  const unit = question.score_unit ?? ''

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs text-slate-400">
            <th className="px-3 py-2 text-left font-normal">受講者</th>
            <th className="w-28 px-3 py-2 text-left font-normal">最新スコア</th>
            <th className="px-3 py-2 text-left font-normal">推移</th>
            <th className="w-32 px-3 py-2 text-left font-normal">最終記録日</th>
          </tr>
        </thead>
        <tbody>
          {byUser.map((entry) => {
            const latest = entry.scores[entry.scores.length - 1]
            return (
              <tr key={entry.userName} className="border-b border-slate-50">
                <td className="whitespace-nowrap px-3 py-2">{entry.userName}</td>
                <td className="px-3 py-2 text-slate-700">
                  {latest.score}
                  {unit ? ` ${unit}` : ''}
                </td>
                <td className="px-3 py-2 text-slate-700">{entry.scores.map((s) => s.score).join(' → ')}</td>
                <td className="px-3 py-2 text-slate-700">{formatDateJst(latest.submittedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-400">
        正誤の概念がないため「AI採点」列はなく、代わりにスコアの推移を表示します。
      </p>
    </>
  )
}

function CorrectBadge({ isCorrect }: { isCorrect: boolean | null }) {
  if (isCorrect === true) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">正解</span>
    )
  }
  if (isCorrect === false) {
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">不正解</span>
  }
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">未回答</span>
}
