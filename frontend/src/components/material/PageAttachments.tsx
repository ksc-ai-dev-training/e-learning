import { useMaterialAttachments } from '../../hooks/useMaterialAttachments'
import { openAttachmentDownload } from '../../lib/attachmentActions'

// 新設: S-16教材受講：ページに、そのページ（node_id）に紐づく添付ファイル・リンクを表示する。
// 編集画面（S-17）では以前から添付できていたが、受講者側の閲覧画面には表示されていなかった
// ギャップを埋める。MaterialView.tsxの「教材全体の資料」セクションと同じ表示・操作方式を、
// ページ単位の一覧（A-28にnode_idを指定）に適用したもの（2026-09-07）。
export default function PageAttachments({ materialId, nodeId }: { materialId: number; nodeId: number }) {
  const { attachments, isLoading } = useMaterialAttachments(materialId, nodeId)

  if (isLoading || attachments.length === 0) return null

  const download = (attachmentId: number) => {
    void openAttachmentDownload(materialId, attachmentId)
  }

  return (
    <section className="mb-5 rounded-md border border-slate-200">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <span className="text-sm font-semibold text-slate-700">このページの資料</span>
      </div>
      <div className="flex flex-wrap gap-4 p-4 text-sm">
        {attachments.map((a) =>
          a.kind === 'link' ? (
            <a
              key={a.id}
              href={a.external_url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              {a.filename}
            </a>
          ) : (
            <button
              key={a.id}
              type="button"
              onClick={() => download(a.id)}
              className="text-blue-700 hover:underline"
            >
              {a.filename}
            </button>
          ),
        )}
      </div>
    </section>
  )
}
