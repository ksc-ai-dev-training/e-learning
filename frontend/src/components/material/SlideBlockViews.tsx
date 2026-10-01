import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import type { SlideBlock } from '../../types'
import SlideImage from './SlideImage'

// スライドブロックの表示用コンポーネント一式。SlideBody.tsx（S-16受講側）と
// SlideBlockEditor.tsx（S-17編集側のライブプレビュー）の両方から共通で使う
// （2026-10-01、編集しながら見た目を確認したいという要望への対応で切り出した）。
// blocksは構造化JSONであり本文（Markdown/HTML）のようにA-64（/preview）を経由した
// サーバーレンダリングは不要なため、純粋なReactコンポーネントとして直接描画する。
// 唯一freeformブロックのcontentだけは本物のMarkdown本文なので、その部分だけ/previewを呼ぶ。
export function SlideBlockView({ block, materialId }: { block: SlideBlock; materialId: number | null }) {
  switch (block.type) {
    case 'header':
      return <HeaderView block={block} />
    case 'banner':
      return <BannerView block={block} />
    case 'bullet_list':
      return <BulletListView block={block} />
    case 'card_row':
      return <CardRowView block={block} />
    case 'highlight':
      return <HighlightView block={block} />
    case 'freeform':
      return <FreeformView block={block} materialId={materialId} />
    case 'compare':
      return <CompareView block={block} />
    case 'timeline':
      return <TimelineView block={block} />
    case 'quote':
      return <QuoteView block={block} />
    case 'table':
      return <TableView block={block} />
    case 'qa':
      return <QaView block={block} />
    case 'code_snippet':
      return <CodeSnippetView block={block} />
    case 'image_gallery':
      return <ImageGalleryView block={block} materialId={materialId} />
    case 'icon_list':
      return <IconListView block={block} />
    case 'image_caption':
      return <ImageCaptionView block={block} materialId={materialId} />
    default:
      return null
  }
}

function HeaderView({ block }: { block: SlideBlock }) {
  return (
    <div className="flex items-center gap-3">
      {block.icon && (
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-2xl font-bold text-white">
          {block.icon}
        </span>
      )}
      <h3 className="flex-1 text-[27px] font-bold text-slate-900 dark:text-neutral-100">{block.title}</h3>
      {block.pill && (
        <span className="flex-shrink-0 rounded-full bg-slate-100 px-3.5 py-1.5 text-lg font-semibold text-slate-700 dark:bg-neutral-800 dark:text-neutral-200">
          {block.pill}
        </span>
      )}
    </div>
  )
}

function BannerView({ block }: { block: SlideBlock }) {
  return (
    <div className="rounded-md bg-slate-900 px-4 py-2.5 text-center text-[21px] font-semibold text-white dark:bg-neutral-800">
      {block.text}
    </div>
  )
}

function BulletListView({ block }: { block: SlideBlock }) {
  const items = (block.items ?? []).filter((v) => v.trim())
  if (items.length === 0) return null
  return (
    <ul className="list-inside list-disc text-[21px] text-slate-700 dark:text-neutral-200">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

const TONE_CLASSES: Record<string, { card: string; icon: string; heading: string }> = {
  rose: {
    card: 'bg-rose-50 dark:bg-rose-950/30',
    icon: 'bg-rose-600',
    heading: 'text-rose-900 dark:text-rose-200',
  },
  green: {
    card: 'bg-emerald-50 dark:bg-emerald-950/30',
    icon: 'bg-emerald-600',
    heading: 'text-emerald-900 dark:text-emerald-200',
  },
  blue: {
    card: 'bg-sky-50 dark:bg-sky-950/30',
    icon: 'bg-sky-600',
    heading: 'text-sky-900 dark:text-sky-200',
  },
  amber: {
    card: 'bg-amber-50 dark:bg-amber-950/30',
    icon: 'bg-amber-600',
    heading: 'text-amber-900 dark:text-amber-200',
  },
}

function CardRowView({ block }: { block: SlideBlock }) {
  const cards = block.cards ?? []
  if (cards.length === 0) return null
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}>
      {cards.map((card, i) => {
        const tone = TONE_CLASSES[card.tone] ?? TONE_CLASSES.rose
        return (
          <div key={i} className={`flex flex-col gap-2 rounded-md p-3.5 ${tone.card}`}>
            <div className={`flex items-center gap-2 text-[21px] font-bold ${tone.heading}`}>
              {card.icon && (
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[16.5px] text-white ${tone.icon}`}>
                  {card.icon}
                </span>
              )}
              {card.heading}
            </div>
            {card.desc && <p className="flex-1 text-lg text-slate-600 dark:text-neutral-300">{card.desc}</p>}
            {card.stat && (
              <div className="rounded bg-white px-2 py-1.5 text-center text-[16.5px] font-bold text-slate-800 dark:bg-neutral-900 dark:text-neutral-100">
                {card.stat}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HighlightView({ block }: { block: SlideBlock }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md bg-amber-50 px-4 py-3 dark:bg-amber-950/20">
      <p className="flex-1 text-[21px] text-slate-700 dark:text-neutral-200">{block.text}</p>
      {block.stat_value && (
        <div className="flex-shrink-0 text-right">
          {block.stat_label && <div className="text-lg font-semibold text-slate-500 dark:text-neutral-400">{block.stat_label}</div>}
          <div className="text-[27px] font-bold text-red-600 dark:text-red-400">{block.stat_value}</div>
        </div>
      )}
    </div>
  )
}

function FreeformView({ block, materialId }: { block: SlideBlock; materialId: number | null }) {
  const [html, setHtml] = useState('')
  const [error, setError] = useState(false)
  const content = block.content ?? ''

  useEffect(() => {
    if (materialId === null || !content.trim()) {
      setHtml('')
      setError(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      apiFetch<{ html: string }>(`/api/materials/${materialId}/preview`, {
        method: 'POST',
        body: JSON.stringify({ body: content, format: 'markdown' }),
      })
        .then((res) => {
          if (!cancelled) setHtml(res.html)
        })
        .catch(() => {
          if (!cancelled) setError(true)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [materialId, content])

  if (!content.trim()) return null
  if (materialId === null) {
    return <p className="text-lg text-slate-400 dark:text-neutral-500">一度下書き保存を行うとプレビューが表示されるようになります</p>
  }
  if (error) return <p className="text-[21px] text-red-600 dark:text-red-400">本文の取得に失敗しました</p>
  return <div className="material-body text-[21px] text-slate-700 dark:text-neutral-200" dangerouslySetInnerHTML={{ __html: html }} />
}

function CompareView({ block }: { block: SlideBlock }) {
  const beforeItems = (block.before_items ?? []).filter((v) => v.trim())
  const afterItems = (block.after_items ?? []).filter((v) => v.trim())
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
      <div className="rounded-md bg-rose-50 p-3.5 dark:bg-rose-950/30">
        <div className="mb-1.5 text-lg font-bold text-rose-800 dark:text-rose-300">{block.before_label || 'Before'}</div>
        <ul className="list-inside list-disc text-lg text-slate-700 dark:text-neutral-200">
          {beforeItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="flex items-center text-slate-400 dark:text-neutral-500">→</div>
      <div className="rounded-md bg-emerald-50 p-3.5 dark:bg-emerald-950/30">
        <div className="mb-1.5 text-lg font-bold text-emerald-800 dark:text-emerald-300">{block.after_label || 'After'}</div>
        <ul className="list-inside list-disc text-lg text-slate-700 dark:text-neutral-200">
          {afterItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function TimelineView({ block }: { block: SlideBlock }) {
  const steps = (block.steps ?? []).filter((s) => s.label.trim())
  if (steps.length === 0) return null
  return (
    <div className="flex items-start gap-0">
      {steps.map((step, i) => (
        <div key={i} className="relative flex flex-1 flex-col items-center px-2 text-center">
          {i < steps.length - 1 && (
            <div className="absolute left-1/2 top-3.5 h-0.5 w-full bg-slate-200 dark:bg-neutral-700" />
          )}
          <div className="relative z-10 mb-2 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-800 text-lg font-bold text-white dark:bg-blue-600">
            {i + 1}
          </div>
          <div className="text-lg font-bold text-slate-800 dark:text-neutral-100">{step.label}</div>
          {step.desc && <div className="text-[16.5px] text-slate-500 dark:text-neutral-400">{step.desc}</div>}
        </div>
      ))}
    </div>
  )
}

function QuoteView({ block }: { block: SlideBlock }) {
  if (!block.text?.trim()) return null
  return (
    <div className="border-l-4 border-blue-800 pl-4 dark:border-blue-500">
      <p className="text-2xl font-semibold italic text-slate-900 dark:text-neutral-100">{block.text}</p>
      {block.source && <p className="mt-1 text-lg text-slate-400 dark:text-neutral-500">— {block.source}</p>}
    </div>
  )
}

function TableView({ block }: { block: SlideBlock }) {
  const headers = block.headers ?? []
  const rows = block.rows ?? []
  if (headers.length === 0 && rows.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-lg">
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left font-semibold text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="border border-slate-200 px-2.5 py-1.5 text-slate-700 dark:border-neutral-700 dark:text-neutral-200">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function QaView({ block }: { block: SlideBlock }) {
  const items = (block.qa_items ?? []).filter((q) => q.question.trim())
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <div key={i} className="rounded-md border border-slate-200 p-3 dark:border-neutral-800">
          <div className="mb-1 flex gap-1.5 text-lg font-bold text-blue-800 dark:text-blue-300">
            <span>Q.</span>
            <span>{item.question}</span>
          </div>
          <div className="flex gap-1.5 text-lg text-slate-600 dark:text-neutral-300">
            <span className="font-bold text-slate-400 dark:text-neutral-500">A.</span>
            <span>{item.answer}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function CodeSnippetView({ block }: { block: SlideBlock }) {
  if (!block.code?.trim()) return null
  return (
    <div>
      {block.caption && <div className="mb-1 text-lg text-slate-400 dark:text-neutral-500">{block.caption}</div>}
      <pre className="overflow-x-auto rounded-md bg-slate-900 px-4 py-3 font-mono text-lg leading-relaxed text-slate-100">
        {block.code}
      </pre>
    </div>
  )
}

function ImageGalleryView({ block, materialId }: { block: SlideBlock; materialId: number | null }) {
  const images = (block.images ?? []).filter((img) => img.attachment_id !== null)
  if (images.length === 0 || materialId === null) return null
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(images.length, 3)}, minmax(0, 1fr))` }}>
      {images.map((img, i) => (
        <figure key={i} className="flex flex-col gap-1">
          <SlideImage materialId={materialId} attachmentId={img.attachment_id} className="w-full rounded-md border border-slate-200 object-cover dark:border-neutral-800" />
          {img.caption && <figcaption className="text-center text-lg text-slate-500 dark:text-neutral-400">{img.caption}</figcaption>}
        </figure>
      ))}
    </div>
  )
}

function IconListView({ block }: { block: SlideBlock }) {
  const items = (block.icon_items ?? []).filter((it) => it.text.trim())
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-2 text-[21px] text-slate-700 dark:text-neutral-200">
          {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  )
}

function ImageCaptionView({ block, materialId }: { block: SlideBlock; materialId: number | null }) {
  if (block.attachment_id === null || block.attachment_id === undefined || materialId === null) return null
  const position = block.image_position ?? 'top'
  const wrapClass = position === 'top' ? 'flex flex-col gap-2' : 'flex items-center gap-4'
  const imageClass = position === 'top' ? 'w-full max-w-md rounded-md border border-slate-200 dark:border-neutral-800' : 'w-48 flex-shrink-0 rounded-md border border-slate-200 dark:border-neutral-800'
  const image = <SlideImage materialId={materialId} attachmentId={block.attachment_id} className={imageClass} />
  const caption = block.caption && <p className="text-[21px] text-slate-600 dark:text-neutral-300">{block.caption}</p>
  return (
    <div className={wrapClass}>
      {position === 'right' ? (
        <>
          {caption}
          {image}
        </>
      ) : (
        <>
          {image}
          {caption}
        </>
      )}
    </div>
  )
}
