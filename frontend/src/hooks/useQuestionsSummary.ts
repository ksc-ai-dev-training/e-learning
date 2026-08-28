import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { QuestionSummaryItem } from '../types'

// 新設: 教材内の全設問をページ横断でフラットに集計する（S-05「問題一覧」タブ）
export function useQuestionsSummary(materialId: number | null) {
  const key = materialId !== null ? `/api/materials/${materialId}/questions-summary` : null
  const { data, error, isLoading } = useSWR<{ items: QuestionSummaryItem[] }>(key, apiFetch)
  return { items: data?.items ?? [], error, isLoading }
}
