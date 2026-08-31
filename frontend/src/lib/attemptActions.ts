import { apiFetch } from './api'
import type { Answer, MaterialNode, QuizAttempt } from '../types'

// A-40: 受験開始（未提出の試行があれば再開）。S-16のページ遷移のたびに呼び、続きから受講を実現する
export function startAttempt(
  materialId: number,
  body: { mode: 'graded' | 'practice'; scope_node_id?: number | null },
): Promise<{ attempt: QuizAttempt; toc: MaterialNode[]; answers: Answer[] }> {
  return apiFetch(`/api/materials/${materialId}/attempts`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// A-41: 回答保存（都度呼び出しで中断・再開を実現する）
export function saveAnswer(attemptId: number, questionId: number, response: unknown): Promise<Answer> {
  return apiFetch(`/api/attempts/${attemptId}/answers`, {
    method: 'PUT',
    body: JSON.stringify({ question_id: questionId, response }),
  })
}

// A-42: 提出（記述式・コード記述式はAI採点を非同期起動）
export function submitAttempt(attemptId: number): Promise<QuizAttempt> {
  return apiFetch(`/api/attempts/${attemptId}/submit`, { method: 'POST' })
}

// A-43: 結果取得。本人なら未提出でも取得できる（誤答のみ抽出モードの状態再取得に使う）
export function getAttempt(attemptId: number): Promise<QuizAttempt & { answers: Answer[] }> {
  return apiFetch(`/api/attempts/${attemptId}`)
}

// A-44: 誤答のみ抽出出題を開始する
export function startWrongQuestionsAttempt(
  materialId: number,
  scope: 'material' | 'all',
): Promise<{ attempts: QuizAttempt[] }> {
  return apiFetch(`/api/materials/${materialId}/wrong-questions-attempts`, {
    method: 'POST',
    body: JSON.stringify({ scope }),
  })
}

// A-88: スコア記録設問の「これまでの記録」
export function getMyQuestionScores(
  questionId: number,
): Promise<{ items: { score: number; recorded_at: string }[] }> {
  return apiFetch(`/api/questions/${questionId}/my-scores`)
}

// A-72: 受験後アンケートへの回答送信
export function submitSurveyResponse(
  surveyId: number,
  answers: { survey_question_id: number; value: unknown }[],
): Promise<{ detail: string }> {
  return apiFetch(`/api/surveys/${surveyId}/responses`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  })
}
