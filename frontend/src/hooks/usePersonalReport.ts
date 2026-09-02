import useSWR from 'swr'
import { apiFetch, ApiError } from '../lib/api'
import type { PersonalAiFeedback, PersonalReport } from '../types'

// A-50: 個人学習レポート（サマリー・学習履歴）
export function usePersonalReport(userId: number | null) {
  const { data, error, isLoading } = useSWR<PersonalReport>(
    userId != null ? `/api/reports/personal/${userId}` : null,
    apiFetch,
  )
  return { report: data, error, isLoading }
}

// A-52: AI個人フィードバック。生成中（404）はnullを返し、SWRの再検証間隔でポーリングする
// （詳細設計書8.2節、既定3秒）。
export function usePersonalAiFeedback(userId: number | null, enabled: boolean) {
  const { data, error, isLoading, mutate } = useSWR<PersonalAiFeedback | null>(
    userId != null && enabled ? `/api/reports/personal/${userId}/ai-feedback` : null,
    async (url: string) => {
      try {
        return await apiFetch<PersonalAiFeedback>(url)
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
    { refreshInterval: (data) => (data ? 0 : 3000) },
  )
  return { feedback: data ?? null, error, isLoading, mutate }
}
