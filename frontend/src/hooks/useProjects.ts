import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { Project, ProjectRole } from '../types'

// A-81: minRole以上のプロジェクト一覧。is_company_wide降順→name昇順でサーバー側ソート済み。
// 既定はeditor（S-13教材編集：プロジェクト選択と同じ）。S-03（教材一覧・検索）はminRole='learner'を
// 指定し、学習者としてのみ参加しているプロジェクトも含める
export function useProjects(minRole: ProjectRole = 'editor') {
  const { data, error, isLoading } = useSWR<{ items: Project[] }>(
    `/api/projects?min_role=${minRole}`,
    apiFetch,
  )
  return { projects: data?.items ?? [], error, isLoading }
}
