import useSWR from 'swr'
import { apiFetch, ApiError } from '../lib/api'
import type { PersonalAiFeedback, PersonalReport } from '../types'

// A-50: 個人学習レポート（サマリー・学習履歴）
export function usePersonalReport(userId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<PersonalReport>(
    userId != null ? `/api/reports/personal/${userId}` : null,
    apiFetch,
  )
  return { report: data, error, isLoading, mutate }
}

// A-52: AI個人フィードバック。画面を開いた時点で必ず1回は確認する（既に生成済みなら、
// 「生成する」ボタンを押していなくてもその内容を表示するため）。生成中（404）で、かつ
// pollingがtrue（「生成する」を押した直後）の間だけ、SWRの再検証間隔でポーリングする
// （詳細設計書8.2節、既定3秒）。以前はpolling中しか問い合わせていなかったため、生成済みの
// フィードバックがあっても画面を開き直すと気づかず「未生成」表示に戻ってしまっていた
// （2026-09-07、ユーザー報告により修正）。
export function usePersonalAiFeedback(userId: number | null, polling: boolean) {
  const { data, error, isLoading, mutate } = useSWR<PersonalAiFeedback | null>(
    userId != null ? `/api/reports/personal/${userId}/ai-feedback` : null,
    async (url: string) => {
      try {
        return await apiFetch<PersonalAiFeedback>(url)
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
    { refreshInterval: (data) => (data || !polling ? 0 : 3000) },
  )
  return { feedback: data ?? null, error, isLoading, mutate }
}
