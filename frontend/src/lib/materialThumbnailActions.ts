import { apiFetch, uploadToSignedUrl } from './api'
import type { Material } from '../types'

// 教材一覧（S-02/S-03/S-12/S-14）サムネイル画像のアップロード・削除（S-05教材設定タブから使う。
// A-76アイコンアップロードと同じ2段階方式: アップロードURL発行→直PUT→PUT /materialsで確定）。

export async function uploadMaterialThumbnail(materialId: number, file: File): Promise<Material> {
  const storage_key = await uploadToSignedUrl(
    `/api/materials/${materialId}/thumbnail/upload-url`,
    file,
    'サムネイル画像のアップロードに失敗しました',
  )
  return apiFetch(`/api/materials/${materialId}`, {
    method: 'PUT',
    body: JSON.stringify({ thumbnail_key: storage_key }),
  })
}

export function resetMaterialThumbnail(materialId: number): Promise<Material> {
  return apiFetch(`/api/materials/${materialId}`, {
    method: 'PUT',
    body: JSON.stringify({ thumbnail_key: null }),
  })
}
