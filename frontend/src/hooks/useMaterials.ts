import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialSource } from '../types'

// A-21: 対象プロジェクトの教材一覧（下書き含む）。更新日の新しい順。
// includeArchivedがfalseの間はアーカイブ済み教材をAPI側で除外する（S-14で「アーカイブ済み」を
// 選んだときのみtrueにして再取得する）。
// projectIdにnullを渡すと取得を行わない（2026-09-24追加。S-12「教材の共有」タブで、実プロジェクト
// 管理者かどうかによってこのフックとuseShareableMaterialsのどちらを使うか切り替えるため、
// 使わない方の呼び出しを無駄にAPIへ問い合わせないようにする。useMaterialSharesの
// materialId: number | nullと同じパターン）。
export function useMaterials(projectId: number | null, includeArchived: boolean = false) {
  const key =
    projectId === null
      ? null
      : includeArchived
        ? `/api/projects/${projectId}/materials/source?include_archived=true`
        : `/api/projects/${projectId}/materials/source`
  const { data, error, isLoading, mutate } = useSWR<{ items: MaterialSource[] }>(key, apiFetch)
  return { materials: data?.items ?? [], error, isLoading, mutate }
}
