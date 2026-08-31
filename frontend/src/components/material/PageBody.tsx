import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'

// S-16説明文パネル。A-64（プレビュー、サニタイズ済みHTML）を1回取得して表示する。
// dangerouslySetInnerHTMLで描画してよいのはA-64が返したサニタイズ済みHTMLのみ（原文を直接描画しない、
// MarkdownHtmlEditorと同じ原則）。ページ遷移のたびにnode.id/body/formatが変わるので都度再取得する。
export default function PageBody({
  materialId,
  body,
  format,
}: {
  materialId: number
  body: string
  format: 'markdown' | 'html'
}) {
  const [html, setHtml] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHtml('')
    setError(false)
    if (!body.trim()) return
    apiFetch<{ html: string }>(`/api/materials/${materialId}/preview`, {
      method: 'POST',
      body: JSON.stringify({ body, format }),
    })
      .then((res) => {
        if (!cancelled) setHtml(res.html)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [materialId, body, format])

  if (!body.trim()) return null

  return (
    <section className="mb-5 rounded-md border border-slate-200">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <span className="text-sm font-semibold text-slate-700">説明</span>
      </div>
      <div className="p-4 text-[13px] leading-[1.9] text-slate-700">
        {error && <p className="text-sm text-red-600">本文の取得に失敗しました</p>}
        {!error && (
          <div
            className="[&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-800 [&_pre]:px-3 [&_pre]:py-2 [&_pre]:text-slate-100 [&_p]:mb-2.5 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </section>
  )
}
