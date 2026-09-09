import type { Question } from '../types'

export interface PageContentInput {
  title: string
  includeExplanation: boolean
  includeQuiz: boolean
  body: string
  questions: Question[]
  quizMode: 'all' | 'pool'
  poolDrawCount: number | null
}

function validateQuestions(qs: Question[]): string | null {
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

// ページ（説明文・問題）の内容バリデーション。MaterialPageEdit.tsx（既存ページの編集画面）・
// InlinePageEditor.tsx（目次編集画面内でのページ新規作成）の両方から共通で使う（2026-09-09）。
export function validatePageContent(input: PageContentInput): string | null {
  if (input.title.trim().length === 0) {
    return 'ページタイトルを入力してください'
  }
  if (!input.includeExplanation && !input.includeQuiz) {
    return '説明文・問題のいずれかを含めてください'
  }
  if (input.includeExplanation && !input.body.trim()) {
    return '説明文を入力してください'
  }
  if (input.includeQuiz) {
    if (input.questions.length === 0) {
      return '問題を1つ以上追加してください'
    }
    const qError = validateQuestions(input.questions)
    if (qError) return qError
    if (input.quizMode === 'pool' && (!input.poolDrawCount || input.poolDrawCount < 1)) {
      return '出題プールの抽出数を1以上で入力してください'
    }
  }
  return null
}
