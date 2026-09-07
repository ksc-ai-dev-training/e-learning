import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { SlackStatus } from '../types'

// 新設（F-12）: S-15プロフィール編集のSlack連携状態
export function useSlackStatus() {
  const { data, error, isLoading, mutate } = useSWR<SlackStatus>('/api/slack/status', apiFetch)
  return { status: data ?? null, error, isLoading, mutate }
}
