import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { Assignment } from '../types'

// data未取得の間、呼び出しのたびに新しい配列参照を返すと、これをuseEffectの依存配列にそのまま
// 使う呼び出し側で読み込み完了まで際限なく再実行されてしまうため、参照を固定しておく
// （2026-09-10、AssignmentEditPanelを公開確認モーダルに組み込んだ際に発覚）。
const EMPTY_ASSIGNMENTS: Assignment[] = []

// A-37: 特定教材の配信設定行一覧（S-06編集パネル）
export function useMaterialAssignments(materialId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ items: Assignment[] }>(
    materialId !== null ? `/api/materials/${materialId}/assignments` : null,
    apiFetch,
  )
  return { assignments: data?.items ?? EMPTY_ASSIGNMENTS, error, isLoading, mutate }
}
