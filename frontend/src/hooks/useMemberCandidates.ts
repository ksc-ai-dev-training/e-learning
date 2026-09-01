import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MemberCandidate } from '../types'

// A-90: メンバー招待先の社員検索（S-12メンバー管理タブ）
export function useMemberCandidates(projectId: number | null, q: string) {
  const key = projectId !== null ? `/api/projects/${projectId}/member-candidates?q=${encodeURIComponent(q)}` : null
  const { data, error, isLoading } = useSWR<{ items: MemberCandidate[] }>(key, apiFetch)
  return { candidates: data?.items ?? [], error, isLoading }
}
