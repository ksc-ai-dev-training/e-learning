import { useState } from 'react'
import AttachmentEntry from './AttachmentEntry'
import type { MaterialAttachment } from '../../types'

const COLLAPSED_COUNT = 3

// 受講画面（S-04「教材全体の資料」・S-16「このページの資料」）共通。添付が多い教材だと
// 一覧が縦に伸び続けてページが読みにくくなるため、既定では先頭3件だけを表示し、
// 「すべて表示」で残りを展開する（2026-09-29、ユーザー要望）。参照専用の一覧のみを対象とし、
// 削除操作を伴うS-05/S-17側の管理一覧（AttachmentList.tsx、AttachmentItem使用）とは別物。
export default function AttachmentEntryList({
  materialId,
  attachments,
}: {
  materialId: number
  attachments: MaterialAttachment[]
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? attachments : attachments.slice(0, COLLAPSED_COUNT)
  const hiddenCount = attachments.length - COLLAPSED_COUNT

  return (
    <div className="flex flex-col gap-3">
      {visible.map((a) => (
        <AttachmentEntry key={a.id} materialId={materialId} attachment={a} />
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300"
        >
          {expanded ? '閉じる' : `すべて表示（他${hiddenCount}件）`}
        </button>
      )}
    </div>
  )
}
