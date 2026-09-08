import { ApiError, apiFetch } from './api'
import type { Me } from '../types'

// A-75: 表示名の変更
export function updateProfileName(name: string): Promise<Me> {
  return apiFetch('/api/auth/me', { method: 'PUT', body: JSON.stringify({ name }) })
}

// A-76 → アップロード → A-75確定、の一連の流れ（attachmentActions.tsのuploadFileAttachmentと同型）
export async function uploadProfileIcon(file: File): Promise<Me> {
  const { upload_url, storage_key } = await apiFetch<{ upload_url: string; storage_key: string }>(
    '/api/auth/me/icon/upload-url',
    {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
      }),
    },
  )
  const res = await fetch(upload_url, { method: 'PUT', credentials: 'same-origin', body: file })
  if (!res.ok) {
    throw new ApiError(res.status, 'アイコン画像のアップロードに失敗しました')
  }
  return apiFetch('/api/auth/me', { method: 'PUT', body: JSON.stringify({ custom_picture_key: storage_key }) })
}

// A-77: Googleのプロフィール画像に戻す
export function resetProfileIcon(): Promise<Me> {
  return apiFetch('/api/auth/me/icon', { method: 'DELETE' })
}
