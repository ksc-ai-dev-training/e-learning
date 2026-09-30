import { useEffect, useState } from 'react'
import type {
  SlideBlock,
  SlideBlockType,
  SlideCard,
  SlideGalleryImage,
  SlideIconListItem,
  SlideQaItem,
  SlideTimelineStep,
} from '../../types'
import {
  SLIDE_BLOCK_TYPES,
  blockTypeLabel,
  defaultBlockForType,
  emptyCard,
  emptyGalleryImage,
  emptyIconListItem,
  emptyQaItem,
  emptyTimelineStep,
} from '../../lib/slideBlockDefaults'
import { getAttachmentDownloadUrl, uploadInlineImageAttachment } from '../../lib/attachmentActions'
import { ApiError } from '../../lib/api'
import MarkdownHtmlEditor from '../ui/MarkdownHtmlEditor'
import Select from '../ui/Select'
import TextArea from '../ui/TextArea'
import TextInput from '../ui/TextInput'

const TYPE_OPTIONS: { value: SlideBlockType; label: string }[] = SLIDE_BLOCK_TYPES.map((value) => ({
  value,
  label: blockTypeLabel(value),
}))

const TONE_OPTIONS = [
  { value: 'rose', label: 'rose（赤系）' },
  { value: 'green', label: 'green（緑系）' },
  { value: 'blue', label: 'blue（青系）' },
  { value: 'amber', label: 'amber（黄系）' },
]

const MAX_CARDS = 4

// スライドの1ブロックを編集するカード（QuestionEditCard.tsxと同型）。上部の種別セレクトで
// 型を切り替えると内容は全置換される（defaultBlockForTypeで作り直す。QuestionEditCardの
// changeTypeと同じ発想。ブロックには設問のrequired/countedのような型を跨いで持ち越す
// 共通フィールドが無いため、単純に全置換でよい）。
export default function BlockEditCard({
  block,
  index,
  materialId,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  block: SlideBlock
  index: number
  materialId: number | null
  onChange: (b: SlideBlock) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const changeType = (value: string) => onChange(defaultBlockForType(value as SlideBlockType))

  return (
    <div className="mb-3 rounded-md border border-slate-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700 dark:text-neutral-100">
          ブロック{index + 1}（{blockTypeLabel(block.type)}）
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30 dark:text-neutral-500 dark:hover:bg-neutral-700"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 disabled:opacity-30 dark:text-neutral-500 dark:hover:bg-neutral-700"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            削除
          </button>
        </div>
      </div>

      <div className="mb-2 flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">種別</label>
        <Select value={block.type} onChange={changeType} options={TYPE_OPTIONS} className="w-40" />
      </div>

      {block.type === 'header' && <HeaderFields block={block} onChange={onChange} />}
      {block.type === 'banner' && <BannerFields block={block} onChange={onChange} />}
      {block.type === 'bullet_list' && <BulletListFields block={block} onChange={onChange} />}
      {block.type === 'card_row' && <CardRowFields block={block} onChange={onChange} />}
      {block.type === 'highlight' && <HighlightFields block={block} onChange={onChange} />}
      {block.type === 'compare' && <CompareFields block={block} onChange={onChange} />}
      {block.type === 'timeline' && <TimelineFields block={block} onChange={onChange} />}
      {block.type === 'quote' && <QuoteFields block={block} onChange={onChange} />}
      {block.type === 'table' && <TableFields block={block} onChange={onChange} />}
      {block.type === 'qa' && <QaFields block={block} onChange={onChange} />}
      {block.type === 'code_snippet' && <CodeSnippetFields block={block} onChange={onChange} />}
      {block.type === 'image_gallery' && <ImageGalleryFields block={block} onChange={onChange} materialId={materialId} />}
      {block.type === 'icon_list' && <IconListFields block={block} onChange={onChange} />}
      {block.type === 'image_caption' && <ImageCaptionFields block={block} onChange={onChange} materialId={materialId} />}
      {block.type === 'freeform' && <FreeformFields block={block} onChange={onChange} materialId={materialId} />}
    </div>
  )
}

function HeaderFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="flex w-20 flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">アイコン</label>
          <TextInput
            value={block.icon ?? ''}
            onChange={(e) => onChange({ ...block, icon: e.target.value })}
            className="text-center"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">タイトル</label>
          <TextInput value={block.title ?? ''} onChange={(e) => onChange({ ...block, title: e.target.value })} />
        </div>
      </div>
      <div className="flex w-48 flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">ピル文言</label>
        <TextInput value={block.pill ?? ''} onChange={(e) => onChange({ ...block, pill: e.target.value })} />
      </div>
    </div>
  )
}

function BannerFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">目的バナーの文言</label>
      <TextArea value={block.text ?? ''} onChange={(e) => onChange({ ...block, text: e.target.value })} rows={2} />
    </div>
  )
}

function BulletListFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  const items = block.items ?? []
  const updateItem = (i: number, value: string) => onChange({ ...block, items: items.map((v, idx) => (idx === i ? value : v)) })
  const addItem = () => onChange({ ...block, items: [...items, ''] })
  const removeItem = (i: number) => onChange({ ...block, items: items.filter((_, idx) => idx !== i) })

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">箇条書き</label>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <TextInput value={item} onChange={(e) => updateItem(i, e.target.value)} className="flex-1" />
          <button
            type="button"
            onClick={() => removeItem(i)}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="mt-1 self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + 項目を追加
      </button>
    </div>
  )
}

function CardRowFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  const cards = block.cards ?? []
  const updateCard = (i: number, card: SlideCard) => onChange({ ...block, cards: cards.map((c, idx) => (idx === i ? card : c)) })
  const addCard = () => onChange({ ...block, cards: [...cards, emptyCard()] })
  const removeCard = (i: number) => onChange({ ...block, cards: cards.filter((_, idx) => idx !== i) })

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">カード（2〜{MAX_CARDS}枚）</label>
      {cards.map((card, i) => (
        <div key={i} className="rounded-md border border-slate-200 p-2.5 dark:border-neutral-800">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-neutral-400">カード{i + 1}</span>
            <button
              type="button"
              onClick={() => removeCard(i)}
              className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              削除
            </button>
          </div>
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Select
              value={card.tone}
              onChange={(v) => updateCard(i, { ...card, tone: v as SlideCard['tone'] })}
              options={TONE_OPTIONS}
              className="w-32"
            />
            <TextInput
              value={card.icon}
              onChange={(e) => updateCard(i, { ...card, icon: e.target.value })}
              className="w-14 text-center"
              placeholder="🛡"
            />
            <TextInput
              value={card.heading}
              onChange={(e) => updateCard(i, { ...card, heading: e.target.value })}
              className="min-w-[140px] flex-1"
              placeholder="見出し"
            />
          </div>
          <TextArea
            value={card.desc}
            onChange={(e) => updateCard(i, { ...card, desc: e.target.value })}
            rows={2}
            placeholder="説明"
            className="mb-1.5"
          />
          <TextInput
            value={card.stat}
            onChange={(e) => updateCard(i, { ...card, stat: e.target.value })}
            placeholder="強調数値（任意）"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={addCard}
        disabled={cards.length >= MAX_CARDS}
        className="self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + カードを追加（最大{MAX_CARDS}枚）
      </button>
    </div>
  )
}

function HighlightFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">本文</label>
        <TextArea value={block.text ?? ''} onChange={(e) => onChange({ ...block, text: e.target.value })} rows={2} />
      </div>
      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">数値ラベル</label>
          <TextInput
            value={block.stat_label ?? ''}
            onChange={(e) => onChange({ ...block, stat_label: e.target.value })}
            placeholder="例: コンフリクト対応"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">強調数値</label>
          <TextInput
            value={block.stat_value ?? ''}
            onChange={(e) => onChange({ ...block, stat_value: e.target.value })}
            placeholder="例: 週 約3件"
          />
        </div>
      </div>
    </div>
  )
}

function FreeformFields({
  block,
  onChange,
  materialId,
}: {
  block: SlideBlock
  onChange: (b: SlideBlock) => void
  materialId: number | null
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">
        自由記述（Markdown。用意したブロックに当てはまらない内容だけ、ここに書けます）
      </label>
      <MarkdownHtmlEditor
        materialId={materialId}
        format="markdown"
        body={block.content ?? ''}
        onBodyChange={(v) => onChange({ ...block, content: v })}
      />
    </div>
  )
}

function CompareFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  const beforeItems = block.before_items ?? []
  const afterItems = block.after_items ?? []
  const updateList = (key: 'before_items' | 'after_items', items: string[]) => onChange({ ...block, [key]: items })

  const renderList = (label: string, key: 'before_items' | 'after_items', items: string[]) => (
    <div className="flex flex-1 flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">{label}</label>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <TextInput
            value={item}
            onChange={(e) => updateList(key, items.map((v, idx) => (idx === i ? e.target.value : v)))}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => updateList(key, items.filter((_, idx) => idx !== i))}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => updateList(key, [...items, ''])}
        className="self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + 項目を追加
      </button>
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        <div className="flex w-32 flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">見出し（左）</label>
          <TextInput value={block.before_label ?? ''} onChange={(e) => onChange({ ...block, before_label: e.target.value })} />
        </div>
        <div className="flex w-32 flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">見出し（右）</label>
          <TextInput value={block.after_label ?? ''} onChange={(e) => onChange({ ...block, after_label: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-4">
        {renderList('左側の項目', 'before_items', beforeItems)}
        {renderList('右側の項目', 'after_items', afterItems)}
      </div>
    </div>
  )
}

function TimelineFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  const steps = block.steps ?? []
  const updateStep = (i: number, step: SlideTimelineStep) => onChange({ ...block, steps: steps.map((s, idx) => (idx === i ? step : s)) })
  const addStep = () => onChange({ ...block, steps: [...steps, emptyTimelineStep()] })
  const removeStep = (i: number) => onChange({ ...block, steps: steps.filter((_, idx) => idx !== i) })

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">手順</label>
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 flex-shrink-0 text-xs text-slate-400 dark:text-neutral-500">{i + 1}.</span>
          <TextInput
            value={step.label}
            onChange={(e) => updateStep(i, { ...step, label: e.target.value })}
            placeholder="見出し"
            className="w-40 flex-shrink-0"
          />
          <TextInput
            value={step.desc}
            onChange={(e) => updateStep(i, { ...step, desc: e.target.value })}
            placeholder="補足（任意）"
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => removeStep(i)}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addStep}
        className="self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + 手順を追加
      </button>
    </div>
  )
}

function QuoteFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">引用文</label>
        <TextArea value={block.text ?? ''} onChange={(e) => onChange({ ...block, text: e.target.value })} rows={2} />
      </div>
      <div className="flex w-64 flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">出典（任意）</label>
        <TextInput value={block.source ?? ''} onChange={(e) => onChange({ ...block, source: e.target.value })} />
      </div>
    </div>
  )
}

function TableFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  const headers = block.headers ?? []
  const rows = block.rows ?? []

  const updateHeader = (i: number, value: string) => onChange({ ...block, headers: headers.map((h, idx) => (idx === i ? value : h)) })
  const addColumn = () =>
    onChange({ ...block, headers: [...headers, ''], rows: rows.map((r) => [...r, '']) })
  const removeColumn = (i: number) =>
    onChange({
      ...block,
      headers: headers.filter((_, idx) => idx !== i),
      rows: rows.map((r) => r.filter((_, idx) => idx !== i)),
    })
  const updateCell = (rowIdx: number, colIdx: number, value: string) =>
    onChange({ ...block, rows: rows.map((r, ri) => (ri === rowIdx ? r.map((c, ci) => (ci === colIdx ? value : c)) : r)) })
  const addRow = () => onChange({ ...block, rows: [...rows, headers.map(() => '')] })
  const removeRow = (i: number) => onChange({ ...block, rows: rows.filter((_, idx) => idx !== i) })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">列見出し</label>
        <div className="flex flex-wrap items-center gap-1.5">
          {headers.map((h, i) => (
            <div key={i} className="flex items-center gap-1">
              <TextInput value={h} onChange={(e) => updateHeader(i, e.target.value)} className="w-28" />
              <button
                type="button"
                onClick={() => removeColumn(i)}
                className="rounded border border-slate-300 px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addColumn}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            + 列を追加
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">行</label>
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-1.5">
            {row.map((cell, ci) => (
              <TextInput key={ci} value={cell} onChange={(e) => updateCell(ri, ci, e.target.value)} className="w-28" />
            ))}
            <button
              type="button"
              onClick={() => removeRow(ri)}
              className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              削除
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          disabled={headers.length === 0}
          className="self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          + 行を追加
        </button>
      </div>
    </div>
  )
}

function QaFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  const items = block.qa_items ?? []
  const updateItem = (i: number, item: SlideQaItem) => onChange({ ...block, qa_items: items.map((it, idx) => (idx === i ? item : it)) })
  const addItem = () => onChange({ ...block, qa_items: [...items, emptyQaItem()] })
  const removeItem = (i: number) => onChange({ ...block, qa_items: items.filter((_, idx) => idx !== i) })

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">Q&amp;A</label>
      {items.map((item, i) => (
        <div key={i} className="rounded-md border border-slate-200 p-2.5 dark:border-neutral-800">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-neutral-400">項目{i + 1}</span>
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              削除
            </button>
          </div>
          <TextInput
            value={item.question}
            onChange={(e) => updateItem(i, { ...item, question: e.target.value })}
            placeholder="質問"
            className="mb-1.5 w-full"
          />
          <TextArea
            value={item.answer}
            onChange={(e) => updateItem(i, { ...item, answer: e.target.value })}
            placeholder="回答"
            rows={2}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + Q&amp;Aを追加
      </button>
    </div>
  )
}

function CodeSnippetFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">注記（任意）</label>
        <TextInput value={block.caption ?? ''} onChange={(e) => onChange({ ...block, caption: e.target.value })} placeholder="例: ターミナルで実行" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">コード</label>
        <TextArea
          value={block.code ?? ''}
          onChange={(e) => onChange({ ...block, code: e.target.value })}
          rows={5}
          className="font-mono text-[13px]"
        />
      </div>
    </div>
  )
}

function ImageGalleryFields({
  block,
  onChange,
  materialId,
}: {
  block: SlideBlock
  onChange: (b: SlideBlock) => void
  materialId: number | null
}) {
  const images = block.images ?? []
  const updateImage = (i: number, img: SlideGalleryImage) => onChange({ ...block, images: images.map((im, idx) => (idx === i ? img : im)) })
  const addImage = () => onChange({ ...block, images: [...images, emptyGalleryImage()] })
  const removeImage = (i: number) => onChange({ ...block, images: images.filter((_, idx) => idx !== i) })

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">画像</label>
      {images.map((img, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md border border-slate-200 p-2 dark:border-neutral-800">
          <ImagePicker
            materialId={materialId}
            attachmentId={img.attachment_id}
            onChange={(id) => updateImage(i, { ...img, attachment_id: id })}
          />
          <TextInput
            value={img.caption}
            onChange={(e) => updateImage(i, { ...img, caption: e.target.value })}
            placeholder="キャプション（任意）"
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => removeImage(i)}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addImage}
        className="self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + 画像を追加
      </button>
    </div>
  )
}

function IconListFields({ block, onChange }: { block: SlideBlock; onChange: (b: SlideBlock) => void }) {
  const items = block.icon_items ?? []
  const updateItem = (i: number, item: SlideIconListItem) => onChange({ ...block, icon_items: items.map((it, idx) => (idx === i ? item : it)) })
  const addItem = () => onChange({ ...block, icon_items: [...items, emptyIconListItem()] })
  const removeItem = (i: number) => onChange({ ...block, icon_items: items.filter((_, idx) => idx !== i) })

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">アイコンリスト</label>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <TextInput
            value={item.icon}
            onChange={(e) => updateItem(i, { ...item, icon: e.target.value })}
            className="w-14 flex-shrink-0 text-center"
            placeholder="✓"
          />
          <TextInput
            value={item.text}
            onChange={(e) => updateItem(i, { ...item, text: e.target.value })}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => removeItem(i)}
            className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="mt-1 self-start rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + 項目を追加
      </button>
    </div>
  )
}

const IMAGE_POSITION_OPTIONS = [
  { value: 'top', label: '画像を上に' },
  { value: 'left', label: '画像を左に' },
  { value: 'right', label: '画像を右に' },
]

function ImageCaptionFields({
  block,
  onChange,
  materialId,
}: {
  block: SlideBlock
  onChange: (b: SlideBlock) => void
  materialId: number | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">画像</label>
        <ImagePicker
          materialId={materialId}
          attachmentId={block.attachment_id ?? null}
          onChange={(id) => onChange({ ...block, attachment_id: id })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">キャプション</label>
        <TextArea value={block.caption ?? ''} onChange={(e) => onChange({ ...block, caption: e.target.value })} rows={2} />
      </div>
      <div className="flex w-40 flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500 dark:text-neutral-300">配置</label>
        <Select
          value={block.image_position ?? 'top'}
          onChange={(v) => onChange({ ...block, image_position: v as SlideBlock['image_position'] })}
          options={IMAGE_POSITION_OPTIONS}
        />
      </div>
    </div>
  )
}

// image_gallery/image_captionで共用する画像アップロードUI。既存のMarkdownHtmlEditor「画像を挿入」と
// 同じuploadInlineImageAttachment（is_inline添付）を使う。削除はattachment_idの参照を外すだけで、
// アップロード済みファイル自体は消さない（MarkdownHtmlEditorの本文からの画像削除と同じ扱い）。
function ImagePicker({
  materialId,
  attachmentId,
  onChange,
}: {
  materialId: number | null
  attachmentId: number | null
  onChange: (id: number | null) => void
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPreviewUrl(null)
    if (materialId === null || attachmentId === null) return
    let cancelled = false
    getAttachmentDownloadUrl(materialId, attachmentId)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [materialId, attachmentId])

  const handleSelect = async (file: File) => {
    if (materialId === null) return
    setUploading(true)
    setError(null)
    try {
      const { id } = await uploadInlineImageAttachment(materialId, file)
      onChange(id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  if (materialId === null) {
    return <p className="text-xs text-slate-400 dark:text-neutral-500">一度下書き保存を行うと画像を追加できるようになります</p>
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      {previewUrl && (
        <img src={previewUrl} alt="" className="h-12 w-12 flex-shrink-0 rounded border border-slate-200 object-cover dark:border-neutral-700" />
      )}
      <label className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
        {uploading ? 'アップロード中...' : attachmentId !== null ? '画像を変更' : '画像を選択'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void handleSelect(file)
          }}
        />
      </label>
      {attachmentId !== null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-slate-400 hover:text-red-600 dark:text-neutral-500 dark:hover:text-red-400"
        >
          削除
        </button>
      )}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  )
}
