import { apiFetch, uploadToSignedUrl } from './api'
import type { Me } from '../types'

// A-75: 表示名の変更
export function updateProfileName(name: string): Promise<Me> {
  return apiFetch('/api/auth/me', { method: 'PUT', body: JSON.stringify({ name }) })
}

// A-76 → アップロード → A-75確定、の一連の流れ（uploadToSignedUrlで共通化、attachmentActions.tsの
// uploadFileAttachmentと同じ手順を使う）
export async function uploadProfileIcon(file: File): Promise<Me> {
  const storage_key = await uploadToSignedUrl(
    '/api/auth/me/icon/upload-url',
    file,
    'アイコン画像のアップロードに失敗しました',
  )
  return apiFetch('/api/auth/me', { method: 'PUT', body: JSON.stringify({ custom_picture_key: storage_key }) })
}

// A-77: Googleのプロフィール画像に戻す
export function resetProfileIcon(): Promise<Me> {
  return apiFetch('/api/auth/me/icon', { method: 'DELETE' })
}
