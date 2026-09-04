import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialAttachment } from '../types'

// A-28: 教材の添付ファイル・リンク一覧（S-05ファイル・リンクタブは全件、S-17は自ページのnode_idで絞り込み）
export function useMaterialAttachments(materialId: number | null, nodeId?: number) {
  const key =
    materialId !== null
      ? `/api/materials/${materialId}/attachments${nodeId !== undefined ? `?node_id=${nodeId}` : ''}`
      : null
  const { data, error, isLoading, mutate } = useSWR<{ items: MaterialAttachment[] }>(key, apiFetch)
  return { attachments: data?.items ?? [], error, isLoading, mutate }
}
