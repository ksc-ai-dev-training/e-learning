import { isPdfAttachment, useAttachmentPreview } from '../../hooks/useAttachmentPreview'
import type { MaterialAttachment } from '../../types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// 添付ファイル・リンクの一覧行（詳細設計書2.1.6節）。S-05ファイル・リンクタブ（参照専用）・
// S-17添付セクション（削除可）で共通利用する。PDFはその場でプレビューできる
// （2026-09-24、受講画面〔AttachmentEntry〕にはあったのに編集側に無かった不便さの解消。
// プレビュー・ダウンロードの状態管理はuseAttachmentPreviewを共有する）。
export default function AttachmentItem({
  materialId,
  attachment,
  onDelete,
}: {
  materialId: number
  attachment: MaterialAttachment
  onDelete?: () => void
}) {
  const { previewUrl, busy, error, download, togglePreview } = useAttachmentPreview(materialId, attachment.id)

  const meta =
    attachment.kind === 'file'
      ? [attachment.mime_type, attachment.size_bytes !== null ? formatBytes(attachment.size_bytes) : null]
          .filter(Boolean)
          .join(' ／ ')
      : attachment.external_url

  return (
    <div className="py-2 text-sm">
      <div className="flex items-center gap-3">
        {attachment.kind === 'file' ? (
          <button
            type="button"
            onClick={() => void download()}
            className="flex-1 truncate text-left text-blue-700 hover:underline"
          >
            {attachment.filename}
          </button>
        ) : (
          <a
            href={attachment.external_url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 truncate text-blue-700 hover:underline"
          >
            {attachment.filename}
          </a>
        )}
        <span className="max-w-[280px] flex-shrink-0 truncate text-xs text-slate-400">
          {meta}
          {attachment.node_id === null ? '（教材全体）' : ''}
        </span>
        {isPdfAttachment(attachment) && (
          <button
            type="button"
            onClick={() => void togglePreview()}
            disabled={busy}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? '読み込み中...' : previewUrl ? '閉じる' : 'プレビュー'}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex-shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            削除
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {previewUrl && (
        <iframe
          src={previewUrl}
          title={attachment.filename}
          className="mt-2 h-[600px] w-full rounded-md border border-slate-200"
        />
      )}
    </div>
  )
}
