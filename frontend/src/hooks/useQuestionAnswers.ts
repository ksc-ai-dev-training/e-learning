import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { QuestionAnswersResponse } from '../types'

// A-73: 指定した設問への全受講者の回答一覧（S-19 設問別の回答・結果一覧）
export function useQuestionAnswers(questionId: number | null) {
  const key = questionId !== null ? `/api/questions/${questionId}/answers` : null
  const { data, error, isLoading } = useSWR<QuestionAnswersResponse>(key, apiFetch)
  return { data, error, isLoading }
}
