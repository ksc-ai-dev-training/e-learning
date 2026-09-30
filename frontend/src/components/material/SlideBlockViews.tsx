import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import type { SlideBlock } from '../../types'

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
    default:
      return null
  }
}

function HeaderView({ block }: { block: SlideBlock }) {
  return (
    <div className="flex items-center gap-3">
      {block.icon && (
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-base font-bold text-white">
          {block.icon}
        </span>
      )}
      <h3 className="flex-1 text-lg font-bold text-slate-900 dark:text-neutral-100">{block.title}</h3>
      {block.pill && (
        <span className="flex-shrink-0 rounded-full bg-slate-100 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:bg-neutral-800 dark:text-neutral-200">
          {block.pill}
        </span>
      )}
    </div>
  )
}

function BannerView({ block }: { block: SlideBlock }) {
  return (
    <div className="rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white dark:bg-neutral-800">
      {block.text}
    </div>
  )
}

function BulletListView({ block }: { block: SlideBlock }) {
  const items = (block.items ?? []).filter((v) => v.trim())
  if (items.length === 0) return null
  return (
    <ul className="list-inside list-disc text-sm text-slate-700 dark:text-neutral-200">
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
            <div className={`flex items-center gap-2 text-sm font-bold ${tone.heading}`}>
              {card.icon && (
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[11px] text-white ${tone.icon}`}>
                  {card.icon}
                </span>
              )}
              {card.heading}
            </div>
            {card.desc && <p className="flex-1 text-xs text-slate-600 dark:text-neutral-300">{card.desc}</p>}
            {card.stat && (
              <div className="rounded bg-white px-2 py-1.5 text-center text-[11px] font-bold text-slate-800 dark:bg-neutral-900 dark:text-neutral-100">
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
      <p className="flex-1 text-sm text-slate-700 dark:text-neutral-200">{block.text}</p>
      {block.stat_value && (
        <div className="flex-shrink-0 text-right">
          {block.stat_label && <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">{block.stat_label}</div>}
          <div className="text-lg font-bold text-red-600 dark:text-red-400">{block.stat_value}</div>
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
    return <p className="text-xs text-slate-400 dark:text-neutral-500">一度下書き保存を行うとプレビューが表示されるようになります</p>
  }
  if (error) return <p className="text-sm text-red-600 dark:text-red-400">本文の取得に失敗しました</p>
  return <div className="material-body text-sm text-slate-700 dark:text-neutral-200" dangerouslySetInnerHTML={{ __html: html }} />
}
