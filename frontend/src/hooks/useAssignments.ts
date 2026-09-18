import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { AssignmentListItem } from '../types'

// A-36: 配信設定一覧（S-06）。管理対象の教材が無い場合はitemsが空配列で返る。
// includeArchivedはA-21のuseMaterialsと同じ意味（2026-09-18新設、アーカイブ済み教材を
// 配信設定からも検索・アーカイブ解除できるようにするため）。statusは元々'draft'/'published'の
// いずれかを送るAPI引数のため、'archived'（フロントエンド側だけのフィルタ値）はそのまま渡さない
// （呼び出し側でincludeArchivedをtrueにしつつ、この引数には空文字を渡す想定）。
export function useAssignments(q: string, status: string, includeArchived = false) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (status) params.set('status', status)
  if (includeArchived) params.set('include_archived', 'true')
  const qs = params.toString()
  const { data, error, isLoading, mutate } = useSWR<{ items: AssignmentListItem[]; total: number }>(
    `/api/assignments${qs ? `?${qs}` : ''}`,
    apiFetch,
  )
  return { items: data?.items ?? [], total: data?.total ?? 0, error, isLoading, mutate }
}
