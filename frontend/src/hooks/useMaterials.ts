import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialSource } from '../types'

// A-21: 対象プロジェクトの教材一覧（下書き含む）。更新日の新しい順。
// includeArchivedがfalseの間はアーカイブ済み教材をAPI側で除外する（S-14で「アーカイブ済み」を
// 選んだときのみtrueにして再取得する）
export function useMaterials(projectId: number, includeArchived: boolean = false) {
  const key = includeArchived
    ? `/api/projects/${projectId}/materials/source?include_archived=true`
    : `/api/projects/${projectId}/materials/source`
  const { data, error, isLoading, mutate } = useSWR<{ items: MaterialSource[] }>(key, apiFetch)
  return { materials: data?.items ?? [], error, isLoading, mutate }
}
