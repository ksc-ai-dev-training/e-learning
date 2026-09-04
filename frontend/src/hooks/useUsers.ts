import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { AdminUser } from '../types'

// A-53: ユーザー一覧（S-10 管理：ユーザー管理タブ、システムadmin専用）
export function useUsers(q: string) {
  const { data, error, isLoading, mutate } = useSWR<{ items: AdminUser[]; total: number }>(
    `/api/users?q=${encodeURIComponent(q)}&per_page=100`,
    apiFetch,
  )
  return { users: data?.items ?? [], total: data?.total ?? 0, error, isLoading, mutate }
}
