import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { ShareableMaterial } from '../types'

// 新規（2026-10-01）: S-12「教材の共有」タブ「このプロジェクトから申請した共有」専用。
// 却下(rejected)以外の共有が1件以上ある教材のみを返す（候補検索用の/materials/shareable・
// A-21 list_materials_sourceをそのまま流用していたため、共有の有無に関わらず対象教材が
// 全件表示されてしまっていた不具合の修正）。canManage・editorを問わず同じAPIで完結する
// （対象範囲の分岐はバックエンド側で行う）。
export function useOutgoingSharedMaterials(projectId: number | null, includeArchived = false) {
  const params = new URLSearchParams()
  if (includeArchived) params.set('include_archived', 'true')
  const query = params.toString()
  const key = projectId === null ? null : `/api/projects/${projectId}/materials/shared${query ? `?${query}` : ''}`
  const { data, error, isLoading } = useSWR<{ items: ShareableMaterial[] }>(key, apiFetch)
  return { items: data?.items ?? [], error, isLoading }
}
