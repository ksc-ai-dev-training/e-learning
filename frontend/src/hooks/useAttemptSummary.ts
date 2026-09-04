import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { AttemptSummaryEntry } from '../types'

// A-86: S-04「前回の受験結果パネル」「AI採点結果パネル」向けの集計取得
export function useAttemptSummary(materialId: number | null) {
  const key = materialId !== null ? `/api/materials/${materialId}/attempt-summary` : null
  const { data, error, isLoading, mutate } = useSWR<{ items: AttemptSummaryEntry[] }>(key, apiFetch)
  return { items: data?.items ?? [], error, isLoading, mutate }
}
