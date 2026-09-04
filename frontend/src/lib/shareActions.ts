import { apiFetch } from './api'
import type { MaterialShare } from '../types'

// A-60: 教材のプロジェクト間共有を申請する（F-26、status='pending'で作成）
export function createMaterialShare(materialId: number, sharedToProjectId: number): Promise<MaterialShare> {
  return apiFetch(`/api/materials/${materialId}/shares`, {
    method: 'POST',
    body: JSON.stringify({ shared_to_project_id: sharedToProjectId }),
  })
}

// A-61: 承認前(status='pending')の共有申請を取り下げる
export function deleteMaterialShare(materialId: number, shareId: number): Promise<void> {
  return apiFetch(`/api/materials/${materialId}/shares/${shareId}`, { method: 'DELETE' })
}

// A-65: 共有申請を承認・却下する（承認時はその場で複製が新規作成される）
export function respondMaterialShare(
  materialId: number,
  shareId: number,
  status: 'accepted' | 'rejected',
): Promise<{ status: string; new_material_id: number | null }> {
  return apiFetch(`/api/materials/${materialId}/shares/${shareId}/respond`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}
