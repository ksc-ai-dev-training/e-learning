import { useState } from 'react'
import Button from '../ui/Button'
import TextInput from '../ui/TextInput'
import { ApiError } from '../../lib/api'
import { addLinkAttachment, uploadFileAttachment } from '../../lib/attachmentActions'

// 添付ファイル・リンクの追加フォーム（ファイル選択＋外部リンク入力）。S-05「ファイル・リンク」タブの
// 教材全体（nodeId=null）向け添付で使う（2026-09-24新設。従来はS-17のページ編集からしか添付を
// 追加できず、目次画面から直接追加できない不便さがあった）。
export default function AttachmentUploadForm({
  materialId,
  nodeId,
  onUploaded,
}: {
  materialId: number
  nodeId: number | null
  onUploaded: () => void | Promise<void>
}) {
  const [linkUrl, setLinkUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      await uploadFileAttachment(materialId, nodeId, file)
      await onUploaded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  const handleAddLink = async () => {
    if (!linkUrl.trim()) return
    setError(null)
    try {
      await addLinkAttachment(materialId, nodeId, linkUrl.trim())
      setLinkUrl('')
      await onUploaded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '追加に失敗しました')
    }
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="flex h-9 min-w-[160px] flex-1 cursor-pointer items-center justify-center rounded-md border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          {uploading ? 'アップロード中...' : 'ファイルを選択'}
          <input type="file" className="hidden" onChange={(e) => void handleFileSelect(e)} disabled={uploading} />
        </label>
        <TextInput
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="または外部リンクを追加 https://..."
          className="min-w-[200px] flex-1"
        />
        <Button variant="secondary" onClick={() => void handleAddLink()} disabled={!linkUrl.trim()}>
          追加
        </Button>
      </div>
    </div>
  )
}
