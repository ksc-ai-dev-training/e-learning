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

// A-103: 過去のAIレビュー結果一覧（新設、2026-09-28）。開いたときにまとめて取得し、
// 「過去の実行結果を見る」を展開したときだけ表示する（普段は使わないため常時取得しない）。
export function useAiReviewHistory(materialId: number | null) {
  const { data, error, isLoading } = useSWR<{ items: AiMaterialReview[] }>(
    materialId !== null ? `/api/materials/${materialId}/ai-reviews` : null,
    apiFetch,
  )
  return { items: data?.items ?? [], error, isLoading }
}
