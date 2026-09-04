import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { PracticeAttemptSummary } from '../types'

// A-87: S-04「反復演習」タブの実施履歴
export function usePracticeAttempts(materialId: number | null) {
  const key = materialId !== null ? `/api/materials/${materialId}/practice-attempts` : null
  const { data, error, isLoading, mutate } = useSWR<{ items: PracticeAttemptSummary[] }>(key, apiFetch)
  return { items: data?.items ?? [], error, isLoading, mutate }
}
