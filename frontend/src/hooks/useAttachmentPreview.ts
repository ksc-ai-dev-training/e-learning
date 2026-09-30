import { useState } from 'react'
import { ApiError } from '../lib/api'
import { getAttachmentDownloadUrl, openAttachmentDownload } from '../lib/attachmentActions'
import type { MaterialAttachment } from '../types'

export function isPdfAttachment(attachment: MaterialAttachment): boolean {
  return (
    attachment.kind === 'file' &&
    (attachment.mime_type === 'application/pdf' || attachment.filename.toLowerCase().endsWith('.pdf'))
  )
}

// 添付ファイルのダウンロード・PDFインラインプレビューの状態管理。AttachmentEntry（S-04/S-16、
// 受講側）・AttachmentItem（S-05/S-17、編集側）の両方で共通利用する（2026-09-24、
// 編集側にプレビュー機能が無かった不便さの解消でAttachmentEntryから切り出した）。
export function useAttachmentPreview(materialId: number, attachmentId: number) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setError(null)
    try {
      await openAttachmentDownload(materialId, attachmentId)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ダウンロードに失敗しました')
    }
  }

  const togglePreview = async () => {
    if (previewUrl) {
      setPreviewUrl(null)
      return
    }
    setError(null)
    setBusy(true)
    try {
      setPreviewUrl(await getAttachmentDownloadUrl(materialId, attachmentId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'プレビューの取得に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return { previewUrl, busy, error, download, togglePreview }
}
