import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { AttemptGradingResponse } from '../types'

// 新規: 受験記録1件分の、手動採点で未確定の設問一覧（下書きがあれば含む）を取得する
// （S-20まとめ採点カードを開いたとき）
export function useAttemptGrading(attemptId: number | null) {
  const key = attemptId !== null ? `/api/attempts/${attemptId}/grading` : null
  const { data, error, isLoading, mutate } = useSWR<AttemptGradingResponse>(key, apiFetch)
  return { data, error, isLoading, mutate }
}
