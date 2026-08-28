import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import TextArea from './TextArea'

// 説明文編集（S-17）。Markdown/HTML切替＋サニタイズ済みプレビュー分割表示（A-64呼び出し、2.1.5節）。
// 基本設計書8.6節が許可する「保存前の未確定コンテンツもサニタイズを通す」2箇所のうちの1つ。
// dangerouslySetInnerHTMLで描画してよいのはA-64が返したサニタイズ済みHTMLのみ（原文を直接描画しない）。
export default function MarkdownHtmlEditor({
  materialId,
  format,
  onFormatChange,
  body,
  onBodyChange,
  className = '',
}: {
  materialId: number
  format: 'markdown' | 'html'
  onFormatChange: (format: 'markdown' | 'html') => void
  body: string
  onBodyChange: (body: string) => void
  className?: string
}) {
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      if (!body.trim()) {
        setPreviewHtml('')
        setPreviewError(false)
        return
      }
      try {
        const res = await apiFetch<{ html: string }>(`/api/materials/${materialId}/preview`, {
          method: 'POST',
          body: JSON.stringify({ body, format }),
        })
        if (!cancelled) {
          setPreviewHtml(res.html)
          setPreviewError(false)
        }
      } catch {
        if (!cancelled) setPreviewError(true)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [materialId, body, format])

  return (
    <div className={className}>
      <div className="mb-2 flex gap-1">
        {(['markdown', 'html'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFormatChange(f)}
            className={`rounded-md border px-3 py-1 text-xs font-semibold ${
              format === f
                ? 'border-blue-800 bg-blue-900 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f === 'markdown' ? 'Markdown' : 'HTML'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-500">本文（{format === 'markdown' ? 'Markdown' : 'HTML'}）</span>
          <TextArea
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            rows={12}
            className="font-mono text-[13px] leading-relaxed"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-500">プレビュー</span>
          <div className="min-h-[280px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
            {previewError && <p className="text-xs text-red-600">プレビューの取得に失敗しました</p>}
            {!previewError && (
              <div
                className="[&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-800 [&_pre]:px-3 [&_pre]:py-2 [&_pre]:text-slate-100 [&_p]:mb-2 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
