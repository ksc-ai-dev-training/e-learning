import { SlideBlockView } from './SlideBlockViews'
import type { SlideBlock } from '../../types'

// S-16説明文パネル（format='slide'用）。PageBody.tsxと同じsection/header-bar/p-4の外枠を持つ。
// 各ブロックの実際の描画はSlideBlockEditor.tsxのライブプレビューと共通のSlideBlockViewを使う。
export default function SlideBody({ materialId, blocks }: { materialId: number; blocks: SlideBlock[] }) {
  if (blocks.length === 0) return null
  return (
    <section className="mb-5 rounded-md border border-slate-200 dark:border-neutral-800">
      <div className="border-b border-slate-200 px-4 py-2.5 dark:border-neutral-800">
        <span className="text-sm font-semibold text-slate-700 dark:text-neutral-100">説明</span>
      </div>
      <div className="p-4">
        <div className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          {blocks.map((block, i) => (
            <SlideBlockView key={i} block={block} materialId={materialId} />
          ))}
        </div>
      </div>
    </section>
  )
}
