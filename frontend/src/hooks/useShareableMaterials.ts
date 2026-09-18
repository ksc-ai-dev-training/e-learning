import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { ShareableMaterial } from '../types'

// 共有申請画面（S-12「教材の共有」タブ）の教材検索。指定したprojectId自身に属する教材を
// タイトルで検索する（qが空でも直近更新順に一覧を返す）。当初「自分が管理者である全プロジェクトを
// 横断検索する」実装だったが、意図は「プロジェクトに関係なく＝どのプロジェクトでも同じように、
// そのプロジェクトに属する教材を検索できる」ことであり複数プロジェクトをまたぐ話ではなかったため、
// projectId必須のプロジェクト単位検索に修正した（2026-09-18）。
// includeArchived（既定false）: アーカイブ済み教材を含めるかどうか。誤って非表示教材を共有
// しないよう既定では含めない（2026-09-18追加）。
export function useShareableMaterials(projectId: number, q: string, includeArchived = false) {
  const params = new URLSearchParams()
  params.set('project_id', String(projectId))
  if (q) params.set('q', q)
  if (includeArchived) params.set('include_archived', 'true')
  const key = `/api/materials/shareable?${params.toString()}`
  const { data, error, isLoading } = useSWR<{ items: ShareableMaterial[] }>(key, apiFetch)
  return { items: data?.items ?? [], error, isLoading }
}
