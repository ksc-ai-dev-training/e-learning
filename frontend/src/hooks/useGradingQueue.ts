import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { GradingQueueResponse } from '../types'

// A-83: 手動採点の未処理分の一覧取得（S-20 採点）。プロジェクトは自分がeditor以上のプロジェクトの
// 中からプルダウンで選ぶ（未選択＝すべて）。以前あったsystem admin専用の「全プロジェクトを表示」
// （scope=all）は権限モデル整理により廃止した（2026-09-17。システムadminであっても自分が
// editor以上として参加するプロジェクトのみが対象になる）。
export function useGradingQueue(projectId: number | null) {
  const params = new URLSearchParams()
  if (projectId !== null) params.set('project_id', String(projectId))
  const qs = params.toString()
  const key = `/api/grading-queue${qs ? `?${qs}` : ''}`
  const { data, error, isLoading, mutate } = useSWR<GradingQueueResponse>(key, apiFetch)
  return { data, error, isLoading, mutate }
}
