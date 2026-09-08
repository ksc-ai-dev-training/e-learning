import useSWR from 'swr'
import { apiFetch, ApiError } from '../lib/api'
import type { DashboardStats, IncompleteUser, OrgReport } from '../types'

// A-45: 受講状況ダッシュボードの集計（S-08）。scopeは"company"または"project:{id}"
export function useDashboardStats(scope: string | null) {
  const { data, error, isLoading } = useSWR<DashboardStats>(
    scope != null ? `/api/dashboard?scope=${encodeURIComponent(scope)}` : null,
    apiFetch,
  )
  return { stats: data, error, isLoading }
}

// A-46: 未受講者一覧（S-08）
export function useIncompleteUsers(scope: string | null) {
  const { data, error, isLoading } = useSWR<{ items: IncompleteUser[] }>(
    scope != null ? `/api/dashboard/incomplete-users?scope=${encodeURIComponent(scope)}` : null,
    apiFetch,
  )
  return { items: data?.items ?? [], error, isLoading }
}

// A-49: AI組織レポート。usePersonalAiFeedback（usePersonalReport.ts）と同じ404→null＋
// pollingパターン（開いた時点で既に生成済みのものは常に取得し、「再生成する」を押した直後だけ
// SWRの再検証間隔でポーリングする）。
export function useOrgReport(scope: string | null, polling: boolean) {
  const { data, error, isLoading, mutate } = useSWR<OrgReport | null>(
    scope != null ? `/api/reports/org?scope=${encodeURIComponent(scope)}` : null,
    async (url: string) => {
      try {
        return await apiFetch<OrgReport>(url)
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
    { refreshInterval: (data) => (data || !polling ? 0 : 3000) },
  )
  return { report: data ?? null, error, isLoading, mutate }
}
