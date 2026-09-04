import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { Assignment } from '../types'

// A-37: 特定教材の配信設定行一覧（S-06編集パネル）
export function useMaterialAssignments(materialId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ items: Assignment[] }>(
    materialId !== null ? `/api/materials/${materialId}/assignments` : null,
    apiFetch,
  )
  return { assignments: data?.items ?? [], error, isLoading, mutate }
}
