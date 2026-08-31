import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { MaterialSearchResponse } from '../types'

export interface MaterialSearchParams {
  q: string
  tags: string[]
  projectId: number | null
  required: 'all' | 'required' | 'optional'
  incompleteOnly: boolean
  myAssignmentsOnly: boolean
  page: number
  perPage: 20 | 50 | 100
}

export const EMPTY_SEARCH_PARAMS: MaterialSearchParams = {
  q: '',
  tags: [],
  projectId: null,
  required: 'all',
  incompleteOnly: false,
  myAssignmentsOnly: false,
  page: 1,
  perPage: 20,
}

function buildQuery(params: MaterialSearchParams): string {
  const sp = new URLSearchParams()
  if (params.q.trim()) sp.set('q', params.q.trim())
  if (params.tags.length > 0) sp.set('tags', params.tags.join(','))
  if (params.projectId !== null) sp.set('project_id', String(params.projectId))
  if (params.required !== 'all') sp.set('required', params.required === 'required' ? 'true' : 'false')
  if (params.incompleteOnly) sp.set('incomplete_only', 'true')
  if (params.myAssignmentsOnly) sp.set('my_assignments_only', 'true')
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
