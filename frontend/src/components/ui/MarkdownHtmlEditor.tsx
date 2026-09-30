import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { apiFetch, ApiError } from '../../lib/api'
import { uploadInlineImageAttachment } from '../../lib/attachmentActions'
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
  // 教材がまだ保存されていない新規作成中（S-05のインラインページ編集）はnull。
  // その間はプレビューAPI（A-64）を呼べる実IDが無いため、プレビュー取得をスキップする
  // （2026-09-09）。
  materialId: number | null
  format: 'markdown' | 'html'
  onFormatChange: (format: 'markdown' | 'html') => void
  body: string
  onBodyChange: (body: string) => void
  className?: string
}) {
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState(false)

  // 「画像を挿入」（2026-09-30新設）: 本文中の好きな位置に写真を貼れるようにする。「資料」欄は
  // 参考資料専用に保ちたいというユーザー方針を受け、ここでアップロードした画像は
  // uploadInlineImageAttachmentでis_inline=true登録し、資料一覧には出さない
  // （AttachmentEntryList.tsx参照）。
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingSelectionRef = useRef<number | null>(null)
  const [insertingImage, setInsertingImage] = useState(false)
  const [insertImageError, setInsertImageError] = useState<string | null>(null)

  // 挿入直後、Reactの再レンダー（bodyがpropとして反映された後）にカーソルを挿入した文字列の
  // 直後へ移動する。selectionStart等はDOM要素の実プロパティのため、状態更新と同期して直接
  // 書き換えることができず、bodyの変化をトリガーに反映する必要がある。
  useLayoutEffect(() => {
    if (pendingSelectionRef.current === null) return
    const pos = pendingSelectionRef.current
    pendingSelectionRef.current = null
    const el = textareaRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(pos, pos)
    }
  }, [body])

  const handleInsertImage = async (file: File) => {
    if (materialId === null) return
    setInsertImageError(null)
    setInsertingImage(true)
    try {
      const { id } = await uploadInlineImageAttachment(materialId, file)
      const altText = file.name.replace(/\.[^./]+$/, '')
      const snippet = format === 'markdown' ? `![${altText}](attachment:${id})` : `<img src="attachment:${id}" alt="${altText}">`
      const el = textareaRef.current
      const start = el?.selectionStart ?? body.length
      const end = el?.selectionEnd ?? body.length
      const nextBody = body.slice(0, start) + snippet + body.slice(end)
      pendingSelectionRef.current = start + snippet.length
      onBodyChange(nextBody)
    } catch (e) {
      setInsertImageError(e instanceof ApiError ? e.message : '画像のアップロードに失敗しました')
    } finally {
      setInsertingImage(false)
    }
  }

  useEffect(() => {
    if (materialId === null) {
      setPreviewHtml('')
      setPreviewError(false)
      return
    }
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

  // タブ切替時、本文テキスト自体は変換されず「解釈のされ方」だけが変わるため、Markdownで書いた
  // #や**等の記号がHTMLタブでは効かない記号としてそのまま表示されてしまい、この状態で保存すると
  // 受講画面での見た目が実質的に失われる不具合があった（20260919_Manabi改善提案.html #6、
  // 実際に本文が消えたという事例あり）。Markdown→HTMLは、既に計算済みのプレビュー結果
  // （previewHtml、A-64のサニタイズ済みHTML）へ本文自体を差し替えることで見た目を保ったまま
  // 変換する。逆方向（HTML→Markdown）はHTML→Markdown変換の手段が無いため、確認ダイアログで
  // 警告するにとどめる。本文が空なら失うものが無いためどちらの方向も確認なしで切り替える。
  const switchFormat = (next: 'markdown' | 'html') => {
    if (next === format) return
    if (!body.trim()) {
      onFormatChange(next)
      return
    }
    if (format === 'markdown' && next === 'html') {
      if (materialId !== null && !previewError && previewHtml) {
        onBodyChange(previewHtml)
        onFormatChange('html')
        return
      }
      if (
        window.confirm(
          'HTMLへ切り替えると、現在のMarkdown記法（#や**など）はそのままの文字として扱われます。続けますか？',
        )
      ) {
        onFormatChange('html')
      }
      return
    }
    if (
      window.confirm('Markdownへ切り替えると、現在のHTMLタグはそのままの文字として扱われます。続けますか？')
    ) {
      onFormatChange('markdown')
    }
  }

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(['markdown', 'html'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => switchFormat(f)}
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
        <label
          className={`flex items-center rounded-md border px-3 py-1 text-xs font-semibold ${
            materialId === null || insertingImage
              ? 'cursor-not-allowed border-slate-200 text-slate-300'
              : 'cursor-pointer border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
          }`}
          title={materialId === null ? '一度下書き保存を行うと画像を挿入できるようになります' : undefined}
        >
          {insertingImage ? 'アップロード中...' : '画像を挿入'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={materialId === null || insertingImage}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void handleInsertImage(file)
            }}
          />
        </label>
      </div>
      {insertImageError && <p className="mb-2 text-xs text-red-600">{insertImageError}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-500">本文（{format === 'markdown' ? 'Markdown' : 'HTML'}）</span>
          <TextArea
            ref={textareaRef}
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            rows={12}
            className="font-mono text-[13px] leading-relaxed"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-500">プレビュー</span>
          <div className="min-h-[280px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
            {materialId === null && (
              <p className="text-xs text-slate-400">一度下書き保存を行うとプレビューが表示されるようになります</p>
            )}
            {materialId !== null && previewError && (
              <p className="text-xs text-red-600">プレビューの取得に失敗しました</p>
            )}
            {materialId !== null && !previewError && (
              <div className="material-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
