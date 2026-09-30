import { apiFetch, uploadToSignedUrl } from './api'

// A-27〜A-29, A-82: S-17添付セクションのアップロード・リンク登録・削除（2画面以上で使わない
// 一回性の操作のためフックではなく素の関数にする。呼び出し側でuseMaterialAttachmentsのmutate()を呼ぶ）。

// nodeId=nullは「教材全体」向けの添付（material_attachments.node_id、5.26節）。
export async function uploadFileAttachment(materialId: number, nodeId: number | null, file: File): Promise<void> {
  const storage_key = await uploadToSignedUrl(
    `/api/materials/${materialId}/attachments/upload-url`,
    file,
    'ファイルのアップロードに失敗しました',
  )
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

// 本文埋め込み用画像アップロード（MarkdownHtmlEditorの「画像を挿入」）。is_inline=trueで
// 登録し、受講画面の「資料」一覧には出さない（2026-09-30新設）。戻り値のidを
// ![alt](attachment:ID)の形で本文に書き込む。
export async function uploadInlineImageAttachment(materialId: number, file: File): Promise<{ id: number }> {
  const storage_key = await uploadToSignedUrl(
    `/api/materials/${materialId}/attachments/upload-url`,
    file,
    '画像のアップロードに失敗しました',
  )
  return apiFetch<{ id: number }>(`/api/materials/${materialId}/attachments`, {
    method: 'POST',
    body: JSON.stringify({
      node_id: null,
      kind: 'file',
      storage_key,
      filename: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      is_inline: true,
    }),
  })
}

export async function addLinkAttachment(materialId: number, nodeId: number | null, url: string): Promise<void> {
  await apiFetch(`/api/materials/${materialId}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ node_id: nodeId, kind: 'link', external_url: url, filename: url }),
  })
}

export async function deleteAttachment(materialId: number, attachmentId: number): Promise<void> {
  await apiFetch(`/api/materials/${materialId}/attachments/${attachmentId}`, { method: 'DELETE' })
}

// A-30: 署名付きダウンロードURLを発行する。PDFの埋め込みプレビュー（<iframe src>）にもそのまま使える
// （Supabase Storageの署名付きURLは通常のHTTPS URLで、GETできれば用途を問わない。2026-09-24追加）。
export async function getAttachmentDownloadUrl(materialId: number, attachmentId: number): Promise<string> {
  const { download_url } = await apiFetch<{ download_url: string; expires_at: string | null }>(
    `/api/materials/${materialId}/attachments/${attachmentId}/download`,
  )
  return download_url
}

// A-30: 署名付きダウンロードURLを発行し、新しいタブで開く（S-04教材全体の資料）
export async function openAttachmentDownload(materialId: number, attachmentId: number): Promise<void> {
  const download_url = await getAttachmentDownloadUrl(materialId, attachmentId)
  window.open(download_url, '_blank', 'noopener')
}
