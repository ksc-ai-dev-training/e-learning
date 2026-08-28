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
