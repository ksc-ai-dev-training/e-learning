import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { GradingQueueResponse } from '../types'

// A-83: 手動採点の未処理分の一覧取得（S-20 採点）。プロジェクトは自分がeditor以上のプロジェクトの
// 中からプルダウンで選ぶ（未選択＝すべて）。scopeAll（「全プロジェクトを表示」）はシステム管理者
// 専用の別軸で、これとは独立に併用できる（2026-09-15、プロジェクト絞り込みをプルダウン化）。
export function useGradingQueue(scopeAll: boolean, projectId: number | null) {
  const params = new URLSearchParams()
  if (scopeAll) params.set('scope', 'all')
  if (projectId !== null) params.set('project_id', String(projectId))
  const qs = params.toString()
  const key = `/api/grading-queue${qs ? `?${qs}` : ''}`
  const { data, error, isLoading, mutate } = useSWR<GradingQueueResponse>(key, apiFetch)
  return { data, error, isLoading, mutate }
}
