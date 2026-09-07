import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MemberOverdueRequired } from '../types'

// 新設（F-11）: S-12「メンバー管理」タブの未受講の必修教材パネル。userIdがnullの間は取得しない
export function useMemberOverdueRequired(projectId: number, userId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<MemberOverdueRequired>(
    userId !== null ? `/api/projects/${projectId}/members/${userId}/overdue-required` : null,
    apiFetch,
  )
  return {
    items: data?.items ?? [],
    error,
    isLoading,
    mutate,
  }
}
