import type { SlideBlock } from '../../types'
import { defaultBlockForType } from '../../lib/slideBlockDefaults'
import BlockEditCard from './BlockEditCard'

// S-17説明文パネル（記述形式「スライド」選択時）。1ページ分のブロックの並びを編集する
// （F-33フェーズ0）。QuestionEditCardの並びと同じ構造だが、こちらは並び替え（↑↓）も持つ
// （設問の並びは目次の章・小見出しで決まるが、スライドのブロックの並びはこの一覧自体が
// 唯一の順序情報のため）。
export default function SlideBlockEditor({
  blocks,
  onBlocksChange,
  materialId,
}: {
  blocks: SlideBlock[]
  onBlocksChange: (blocks: SlideBlock[]) => void
  materialId: number | null
}) {
  const addBlock = () => onBlocksChange([...blocks, defaultBlockForType('header')])
  const updateBlock = (i: number, b: SlideBlock) => onBlocksChange(blocks.map((old, idx) => (idx === i ? b : old)))
  const deleteBlock = (i: number) => onBlocksChange(blocks.filter((_, idx) => idx !== i))
  const moveBlock = (i: number, dir: -1 | 1) => {
    const target = i + dir
    if (target < 0 || target >= blocks.length) return
    const next = [...blocks]
    ;[next[i], next[target]] = [next[target], next[i]]
    onBlocksChange(next)
  }

  return (
    <div className="flex flex-col gap-1">
      {blocks.map((block, i) => (
        <BlockEditCard
          key={i}
          block={block}
          index={i}
          materialId={materialId}
          onChange={(b) => updateBlock(i, b)}
          onDelete={() => deleteBlock(i)}
          onMoveUp={() => moveBlock(i, -1)}
          onMoveDown={() => moveBlock(i, 1)}
          canMoveUp={i > 0}
          canMoveDown={i < blocks.length - 1}
        />
      ))}
      {blocks.length === 0 && (
        <p className="mb-1 text-xs text-slate-400 dark:text-neutral-500">
          まだブロックがありません。下の「+ ブロックを追加」から作り始めてください。
        </p>
      )}
      <button
        type="button"
        onClick={addBlock}
        className="self-start rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        + ブロックを追加
      </button>
    </div>
  )
}
