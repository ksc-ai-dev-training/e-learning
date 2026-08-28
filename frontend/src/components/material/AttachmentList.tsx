import type { MaterialAttachment } from '../../types'
import AttachmentItem from './AttachmentItem'

// 添付ファイル・リンクの一覧（詳細設計書2.1.6節）。onDelete省略時は削除ボタンを出さない
// （S-05ファイル・リンクタブは参照専用のため省略、S-17添付セクションは指定して使う）。
export default function AttachmentList({
  attachments,
  onDelete,
  isLoading,
}: {
  attachments: MaterialAttachment[]
  onDelete?: (attachmentId: number) => void
  isLoading?: boolean
}) {
  if (isLoading) {
    return <p className="text-sm text-slate-400">読み込み中...</p>
  }
  if (attachments.length === 0) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
        まだファイル・リンクがありません。
      </p>
    )
  }
  return (
    <div className="divide-y divide-slate-100">
      {attachments.map((a) => (
        <AttachmentItem key={a.id} attachment={a} onDelete={onDelete ? () => onDelete(a.id) : undefined} />
      ))}
    </div>
  )
}
