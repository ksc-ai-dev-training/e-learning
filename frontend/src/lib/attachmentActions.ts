import { ApiError, apiFetch } from './api'

// A-27〜A-29, A-82: S-17添付セクションのアップロード・リンク登録・削除（2画面以上で使わない
// 一回性の操作のためフックではなく素の関数にする。呼び出し側でuseMaterialAttachmentsのmutate()を呼ぶ）。

export async function uploadFileAttachment(materialId: number, nodeId: number, file: File): Promise<void> {
  const { upload_url, storage_key } = await apiFetch<{ upload_url: string; storage_key: string }>(
    `/api/materials/${materialId}/attachments/upload-url`,
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
    throw new ApiError(res.status, 'ファイルのアップロードに失敗しました')
  }
  await apiFetch(`/api/materials/${materialId}/attachments`, {
    method: 'POST',
    body: JSON.stringify({
      node_id: nodeId,
      kind: 'file',
      storage_key,
      filename: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
    }),
  })
}

export async function addLinkAttachment(materialId: number, nodeId: number, url: string): Promise<void> {
  await apiFetch(`/api/materials/${materialId}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ node_id: nodeId, kind: 'link', external_url: url, filename: url }),
  })
}

export async function deleteAttachment(materialId: number, attachmentId: number): Promise<void> {
  await apiFetch(`/api/materials/${materialId}/attachments/${attachmentId}`, { method: 'DELETE' })
}

// A-30: 署名付きダウンロードURLを発行し、新しいタブで開く（S-04教材全体の資料）
export async function openAttachmentDownload(materialId: number, attachmentId: number): Promise<void> {
  const { download_url } = await apiFetch<{ download_url: string; expires_at: string | null }>(
    `/api/materials/${materialId}/attachments/${attachmentId}/download`,
  )
  window.open(download_url, '_blank', 'noopener')
}
