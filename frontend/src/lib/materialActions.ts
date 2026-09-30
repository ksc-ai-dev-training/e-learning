import { apiFetch } from './api'
import type { Material } from '../types'

// 新規（A-84/A-85）: 教材のアーカイブ・復元。S-05のヘッダー、S-14の「復元」ボタンから呼ぶ
export function archiveMaterial(id: number): Promise<Material> {
  return apiFetch<Material>(`/api/materials/${id}/archive`, { method: 'PUT' })
}

export function restoreMaterial(id: number): Promise<Material> {
  return apiFetch<Material>(`/api/materials/${id}/restore`, { method: 'PUT' })
}

// 新規（A-18）: 教材の物理削除。一度も公開したことのない下書き（status='draft'）のみ対象
export function deleteMaterial(id: number): Promise<void> {
  return apiFetch<void>(`/api/materials/${id}`, { method: 'DELETE' })
}

// 新規（A-17、status='published'）: 教材の公開。設問の必須項目は保存時点（A-20/A-31）で
// 既に検証済みのため、公開時に改めての内容検証は行わない
export function publishMaterial(id: number): Promise<Material> {
  return apiFetch<Material>(`/api/materials/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'published' }),
  })
}

// 新規（A-95）: 自分の受講進捗を未受講に戻す（S-09学習履歴）。受験記録（quiz_attempts等）は
// 削除しない
export function resetMaterialProgress(id: number): Promise<void> {
  return apiFetch<void>(`/api/materials/${id}/progress`, { method: 'DELETE' })
}

// 新規（2026-09-25）: 学習履歴から削除（S-09学習履歴の「履歴から削除」ボタン、本人のみ）。
// A-95「未受講に戻す」と異なり、S-09の一覧・S-04の採点結果パネルから完全に見えなくする。
// 受験記録自体は論理削除のみで、再受験回数の上限には一切影響しない
// （backend/routers/learning.pyのdelete_material_history参照）
export function deleteMaterialHistory(id: number): Promise<void> {
  return apiFetch<void>(`/api/materials/${id}/history`, { method: 'DELETE' })
}
