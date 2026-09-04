import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialRevision } from '../types'

// A-22: 教材改訂履歴（S-05改訂履歴タブ）。新しい順。
// 対象年月の絞り込み・「全期間を表示」はクライアント側フィルタで行うため、
// ページネーションUIは実装せずper_pageを大きめに指定してまとめて取得する。
export function useMaterialRevisions(materialId: number | null) {
  const { data, error, isLoading } = useSWR<{ items: MaterialRevision[]; total: number }>(
    materialId !== null ? `/api/materials/${materialId}/revisions?per_page=200` : null,
    apiFetch,
  )
  return { revisions: data?.items ?? [], total: data?.total ?? 0, error, isLoading }
}
