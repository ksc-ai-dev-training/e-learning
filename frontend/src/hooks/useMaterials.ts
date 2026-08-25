import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialSource } from '../types'

// A-21: 対象プロジェクトの教材一覧（下書き含む）。更新日の新しい順
export function useMaterials(projectId: number) {
  const { data, error, isLoading } = useSWR<{ items: MaterialSource[] }>(
    `/api/projects/${projectId}/materials/source`,
    apiFetch,
  )
  return { materials: data?.items ?? [], error, isLoading }
}
