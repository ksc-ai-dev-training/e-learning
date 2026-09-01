import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { IncomingMaterialShare } from '../types'

// A-66: 自プロジェクト宛ての教材共有申請一覧（S-12教材の共有タブ、承認側。F-26）
export function useIncomingShares(projectId: number | null, status: string = 'pending') {
  const { data, error, isLoading, mutate } = useSWR<{ items: IncomingMaterialShare[] }>(
    projectId !== null ? `/api/projects/${projectId}/incoming-shares?status=${status}` : null,
    apiFetch,
  )
  return { incomingShares: data?.items ?? [], error, isLoading, mutate }
}
