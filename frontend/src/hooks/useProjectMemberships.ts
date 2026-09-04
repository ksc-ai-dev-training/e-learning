import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { ProjectMembership } from '../types'

// A-11: 対象プロジェクトのメンバー一覧（S-05プロジェクトメンバータブ、S-12メンバー管理タブ）
export function useProjectMemberships(projectId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ items: ProjectMembership[] }>(
    projectId !== null ? `/api/project-memberships?project_id=${projectId}` : null,
    apiFetch,
  )
  return { memberships: data?.items ?? [], error, isLoading, mutate }
}
