import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { SystemSettings } from '../types'

// A-55: システム設定の現在値取得（S-10 管理：システム設定タブ）
export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<SystemSettings>('/api/settings', apiFetch)
  return { settings: data, error, isLoading, mutate }
}
