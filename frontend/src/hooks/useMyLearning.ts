import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MyLearningItem, MyLearningResponse } from '../types'

// A-39: マイ学習一覧（必修・任意、S-02）
export function useMyLearning() {
  const { data, error, isLoading, mutate } = useSWR<MyLearningResponse>('/api/my-learning', apiFetch)
  return {
    required: data?.required ?? [],
    optional: data?.optional ?? [],
    stats: data?.stats,
    error,
    isLoading,
    mutate,
  }
}

// A-39（history=true）: 登録・現在の受講対象かどうかを問わない学習履歴
export function useMyLearningHistory(enabled: boolean) {
  const { data, error, isLoading } = useSWR<{ items: MyLearningItem[] }>(
    enabled ? '/api/my-learning?history=true' : null,
    apiFetch,
  )
  return { items: data?.items ?? [], error, isLoading }
}
