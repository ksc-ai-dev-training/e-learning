import { isPdfAttachment, useAttachmentPreview } from '../../hooks/useAttachmentPreview'
import type { MaterialAttachment } from '../../types'

// 受講画面（S-04「教材全体の資料」・S-16「このページの資料」）で共通利用する添付1件分の表示行。
// PowerPointはPDFへ書き出して添付すれば、ダウンロードせずその場でスライドの見た目のまま
// 確認できるようにする（20260919_Manabi改善提案.html #2、B案「PDFビューア表示」）。
// 新規のバックエンド実装は不要で、既存の署名付きダウンロードURL（A-30）をiframeのsrcに
// そのまま使えることを確認した上で採用した。ダウンロード・プレビューの状態管理は
// useAttachmentPreviewに切り出し、編集側のAttachmentItemとも共有する。
export default function AttachmentEntry({
  materialId,
  attachment,
}: {
  materialId: number
  attachment: MaterialAttachment
}) {
  const { previewUrl, busy, error, download, togglePreview } = useAttachmentPreview(materialId, attachment.id)

  if (attachment.kind === 'link') {
    return (
      <a href={attachment.external_url ?? '#'} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">
        {attachment.filename}
      </a>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void download()} className="text-blue-700 hover:underline">
          {attachment.filename}
        </button>
        {isPdfAttachment(attachment) && (
          <button
            type="button"
            onClick={() => void togglePreview()}
            disabled={busy}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? '読み込み中...' : previewUrl ? '閉じる' : 'プレビュー'}
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
