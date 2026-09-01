import { apiFetch } from './api'
import type { Assignment } from '../types'

export interface AssignmentInput {
  id: number | null
  scope_type: 'project' | 'individual'
  scope_id: number
  required: boolean
  due_at: string | null
}

// A-38: 教材の配信設定を全置換する
export function updateMaterialAssignments(
  materialId: number,
  assignments: AssignmentInput[],
): Promise<{ items: Assignment[] }> {
  return apiFetch(`/api/materials/${materialId}/assignments`, {
    method: 'PUT',
    body: JSON.stringify({ assignments }),
  })
}
