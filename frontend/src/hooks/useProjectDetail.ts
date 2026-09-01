import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { ProjectDetail } from '../types'

// A-91: プロジェクト詳細（S-12プロジェクト情報タブ）
export function useProjectDetail(projectId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<ProjectDetail>(
    projectId !== null ? `/api/projects/${projectId}` : null,
    apiFetch,
  )
  return { project: data, error, isLoading, mutate }
}
