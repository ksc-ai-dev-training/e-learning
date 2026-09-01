import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialNode } from '../types'

export interface MaterialPreviewData {
  id: number
  title: string
  description: string | null
  toc: MaterialNode[]
}

// A-94: S-05「プレビュー」ボタン専用。教材全体（正解込みの全設問）を一括取得する
export function useMaterialPreview(materialId: number | null) {
  const { data, error, isLoading } = useSWR<MaterialPreviewData>(
    materialId !== null ? `/api/materials/${materialId}/preview-tree` : null,
    apiFetch,
  )
  return { preview: data, error, isLoading }
}
