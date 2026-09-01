import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { AssignmentListItem } from '../types'

// A-36: 配信設定一覧（S-06）。管理対象の教材が無い場合はitemsが空配列で返る
export function useAssignments(q: string, status: string) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (status) params.set('status', status)
  const qs = params.toString()
  const { data, error, isLoading, mutate } = useSWR<{ items: AssignmentListItem[]; total: number }>(
    `/api/assignments${qs ? `?${qs}` : ''}`,
    apiFetch,
  )
  return { items: data?.items ?? [], total: data?.total ?? 0, error, isLoading, mutate }
}
