import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { PracticeAttemptSummary } from '../types'

// A-87: S-04「練習」「誤答＆難問抽出」タブの実施履歴（practiceKindで両者を切り替える）
export function usePracticeAttempts(materialId: number | null, practiceKind: 'repeat' | 'wrong_only' = 'repeat') {
  const key = materialId !== null ? `/api/materials/${materialId}/practice-attempts?practice_kind=${practiceKind}` : null
  const { data, error, isLoading, mutate } = useSWR<{ items: PracticeAttemptSummary[] }>(key, apiFetch)
  return { items: data?.items ?? [], error, isLoading, mutate }
}
