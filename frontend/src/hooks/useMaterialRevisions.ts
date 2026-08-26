import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialRevision } from '../types'

// A-22: 教材改訂履歴（S-05改訂履歴タブ）。新しい順
export function useMaterialRevisions(materialId: number | null) {
  const { data, error, isLoading } = useSWR<{ items: MaterialRevision[]; total: number }>(
    materialId !== null ? `/api/materials/${materialId}/revisions` : null,
    apiFetch,
  )
  return { revisions: data?.items ?? [], total: data?.total ?? 0, error, isLoading }
}
