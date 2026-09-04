import useSWR from 'swr'
import { ApiError, apiFetch } from '../lib/api'
import type { AiMaterialReview } from '../types'

// A-33: 直近のAIレビュー結果（S-05 AIレビュー結果タブ）。一度も実行していない場合は404だが、
// これは「未実施」を表す正常な状態のためエラー扱いにせずnullとして返す。
async function fetchLatestReview(path: string): Promise<AiMaterialReview | null> {
  try {
    return await apiFetch<AiMaterialReview>(path)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export function useAiReview(materialId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<AiMaterialReview | null>(
    materialId !== null ? `/api/materials/${materialId}/ai-review` : null,
    fetchLatestReview,
  )
  return { review: data ?? null, error, isLoading, mutate }
}

// A-32: AIレビューを実行する。結果はuseAiReviewのmutateでキャッシュへ反映する
export function runAiReview(materialId: number): Promise<AiMaterialReview> {
  return apiFetch<AiMaterialReview>(`/api/materials/${materialId}/ai-review`, { method: 'POST' })
}
