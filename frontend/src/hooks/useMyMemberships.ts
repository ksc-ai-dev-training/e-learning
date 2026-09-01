import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { ProjectMembership } from '../types'

// A-11: 自分の参加プロジェクト一覧（user_id=自分。S-11「自分が参加しているプロジェクト」表示用）
export function useMyMemberships(userId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ items: ProjectMembership[] }>(
    userId !== null ? `/api/project-memberships?user_id=${userId}` : null,
    apiFetch,
  )
  return { memberships: data?.items ?? [], error, isLoading, mutate }
}
