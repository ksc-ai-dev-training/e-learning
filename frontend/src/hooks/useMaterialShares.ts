import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialShare } from '../types'

// A-59: 教材のプロジェクト間共有一覧（S-12教材の共有タブ、申請側。F-26）
export function useMaterialShares(materialId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ items: MaterialShare[] }>(
    materialId !== null ? `/api/materials/${materialId}/shares` : null,
    apiFetch,
  )
  return { shares: data?.items ?? [], error, isLoading, mutate }
}
