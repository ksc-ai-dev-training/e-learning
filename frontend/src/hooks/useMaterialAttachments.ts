import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialAttachment } from '../types'

// A-28: 教材の添付ファイル・リンク一覧（S-05ファイル・リンクタブ）。教材全体分＋各ページ分の全件
export function useMaterialAttachments(materialId: number | null) {
  const { data, error, isLoading } = useSWR<{ items: MaterialAttachment[] }>(
    materialId !== null ? `/api/materials/${materialId}/attachments` : null,
    apiFetch,
  )
  return { attachments: data?.items ?? [], error, isLoading }
}
