import type { SlideBlock, SlideBlockType, SlideCard } from '../../types'
import { SLIDE_BLOCK_TYPES, blockTypeLabel, defaultBlockForType, emptyCard } from '../../lib/slideBlockDefaults'
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
