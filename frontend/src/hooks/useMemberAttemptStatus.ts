import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MemberAttemptItem } from '../types'

// 新設: S-12「メンバー管理」タブの受験状況パネル（REQ-F-09）。userIdがnullの間は取得しない
export function useMemberAttemptStatus(projectId: number, userId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ items: MemberAttemptItem[] }>(
    userId !== null ? `/api/projects/${projectId}/members/${userId}/attempts` : null,
    apiFetch,
  )
  return { items: data?.items ?? [], error, isLoading, mutate }
}
