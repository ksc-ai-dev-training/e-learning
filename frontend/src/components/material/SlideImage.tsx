import { useEffect, useState } from 'react'
import { getAttachmentDownloadUrl } from '../../lib/attachmentActions'

// image_gallery/image_captionブロックの画像表示。attachment_idはis_inline添付として登録した
// 画像のIDで、本文のattachment:ID記法と同じ仕組み（MarkdownHtmlEditorの「画像を挿入」参照）だが、
// こちらは構造化フィールドとして持つため、表示のたびに署名付きダウンロードURLを解決する
// （2026-10-01、F-33フェーズ1）。
export default function SlideImage({
  materialId,
  attachmentId,
  alt = '',
  className = '',
}: {
  materialId: number
  attachmentId: number | null
  alt?: string
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setUrl(null)
    setError(false)
    if (attachmentId === null) return
    let cancelled = false
    getAttachmentDownloadUrl(materialId, attachmentId)
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [materialId, attachmentId])

  if (attachmentId === null) return null
  if (error) return <p className="text-xs text-red-600 dark:text-red-400">画像の取得に失敗しました</p>
  if (!url) return <div className={`animate-pulse rounded-md bg-slate-100 dark:bg-neutral-800 ${className}`} />
  return <img src={url} alt={alt} className={className} />
}
