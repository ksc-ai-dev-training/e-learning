import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { Project } from '../types'

// A-81: editor以上のプロジェクト一覧。is_company_wide降順→name昇順でサーバー側ソート済み
export function useProjects() {
  const { data, error, isLoading } = useSWR<{ items: Project[] }>('/api/projects', apiFetch)
  return { projects: data?.items ?? [], error, isLoading }
}
