import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { GradingQueueResponse } from '../types'

// A-83: 手動採点の未処理分の一覧取得（S-20 採点）。プロジェクト・教材の絞り込みは対象件数が
// 個人の管理範囲に収まる小規模なものであるため（A-36と同じ考え方）クライアント側で行い、
// ここではscope（自分の担当分/全プロジェクト）だけをサーバーに問い合わせる
export function useGradingQueue(scopeAll: boolean) {
  const key = `/api/grading-queue${scopeAll ? '?scope=all' : ''}`
  const { data, error, isLoading, mutate } = useSWR<GradingQueueResponse>(key, apiFetch)
  return { data, error, isLoading, mutate }
}
