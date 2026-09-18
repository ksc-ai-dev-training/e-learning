import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { ShareableMaterial } from '../types'

// 新規（2026-09-18）: 共有申請画面のプロジェクト横断検索。自分がプロジェクト管理者である
// 全プロジェクトの教材をタイトルで検索する（qが空でも直近更新順に一覧を返す）。
export function useShareableMaterials(q: string) {
  const key = `/api/materials/shareable${q ? `?q=${encodeURIComponent(q)}` : ''}`
  const { data, error, isLoading } = useSWR<{ items: ShareableMaterial[] }>(key, apiFetch)
  return { items: data?.items ?? [], error, isLoading }
}
