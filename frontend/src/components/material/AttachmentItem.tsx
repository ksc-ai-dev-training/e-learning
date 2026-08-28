import type { MaterialAttachment } from '../../types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// 添付ファイル・リンクの一覧行（詳細設計書2.1.6節）。S-05ファイル・リンクタブ（参照専用）・
// S-17添付セクション（削除可）で共通利用する。
export default function AttachmentItem({
  attachment,
  onDelete,
}: {
  attachment: MaterialAttachment
  onDelete?: () => void
}) {
  const meta =
    attachment.kind === 'file'
      ? [attachment.mime_type, attachment.size_bytes !== null ? formatBytes(attachment.size_bytes) : null]
          .filter(Boolean)
          .join(' ／ ')
      : attachment.external_url

  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      <span className="flex-1 truncate">{attachment.filename}</span>
      <span className="max-w-[280px] truncate text-xs text-slate-400">
        {meta}
        {attachment.node_id === null ? '（教材全体）' : ''}
      </span>
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
  )
}
