import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialSearchResponse } from '../types'

export interface MaterialSearchParams {
  q: string
  tags: string[]
  // 複数プロジェクトを同時に選べるトグル式（2026-10-01、ユーザー要望。以前は単一選択で、
  // 別のプロジェクトボタンを押すと選択が切り替わってしまっていた）
  projectIds: number[]
  required: 'all' | 'required' | 'optional'
  incompleteOnly: boolean
  page: number
  perPage: 20 | 50 | 100
}

export const EMPTY_SEARCH_PARAMS: MaterialSearchParams = {
  q: '',
  tags: [],
  projectIds: [],
  required: 'all',
  incompleteOnly: false,
  page: 1,
  perPage: 20,
}

function buildQuery(params: MaterialSearchParams): string {
  const sp = new URLSearchParams()
  if (params.q.trim()) sp.set('q', params.q.trim())
  if (params.tags.length > 0) sp.set('tags', params.tags.join(','))
  if (params.projectIds.length > 0) sp.set('project_ids', params.projectIds.join(','))
  if (params.required !== 'all') sp.set('required', params.required === 'required' ? 'true' : 'false')
  if (params.incompleteOnly) sp.set('incomplete_only', 'true')
  sp.set('page', String(params.page))
  sp.set('per_page', String(params.perPage))
  return sp.toString()
}

// A-14: 公開教材の一覧・検索（S-03）
export function useMaterialsSearch(params: MaterialSearchParams) {
  const key = `/api/materials?${buildQuery(params)}`
  const { data, error, isLoading, mutate } = useSWR<MaterialSearchResponse>(key, apiFetch)
  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    availableTags: data?.available_tags ?? [],
    error,
    isLoading,
    mutate,
  }
}
