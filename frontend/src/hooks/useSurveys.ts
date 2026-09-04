import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { Survey } from '../types'

// A-78: 教材に設置されたアンケート一覧（教材全体分＋章ごと）
export function useSurveys(materialId: number | null) {
  const key = materialId !== null ? `/api/materials/${materialId}/surveys` : null
  const { data, error, isLoading, mutate } = useSWR<{ items: Survey[] }>(key, apiFetch)
  return { surveys: data?.items ?? [], error, isLoading, mutate }
}
