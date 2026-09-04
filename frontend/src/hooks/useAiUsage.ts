import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { AiUsageSummary } from '../types'

// A-58: 指定月（省略時は当月）のAI利用状況（機能別内訳込み）。S-10 管理：システム設定タブ
export function useAiUsage(month: string) {
  const { data, error, isLoading } = useSWR<AiUsageSummary>(
    `/api/settings/ai-usage?month=${month}`,
    apiFetch,
  )
  return { usage: data, error, isLoading }
}
