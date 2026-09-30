import { getThumbnailPlaceholder } from '../../lib/materialThumbnailPlaceholder'

interface MaterialThumbnailProps {
  material: { id: number; title: string; thumbnail_url?: string | null }
  size: 'sm' | 'lg'
  className?: string
}

const SIZE_CLASSES: Record<'sm' | 'lg', string> = {
  sm: 'h-10 w-14 rounded text-sm',
  lg: 'aspect-video w-full rounded-t-lg text-2xl',
}

// 教材一覧（S-02/S-03/S-12/S-14）共通のサムネイル表示。thumbnail_urlが未設定の場合は
// 教材IDから機械生成したプレースホルダー（色分け＋タイトル頭文字）を表示する。写真的な要素
// なのでライト/ダーク共通の見た目にする（ボタンの塗り色・コードエディタ配色と同じ方針）。
export default function MaterialThumbnail({ material, size, className = '' }: MaterialThumbnailProps) {
  const sizeClass = SIZE_CLASSES[size]
  if (material.thumbnail_url) {
    return (
      <img
        src={material.thumbnail_url}
        alt=""
        className={`flex-shrink-0 object-cover ${sizeClass} ${className}`}
      />
    )
  }
  const { gradient, initial } = getThumbnailPlaceholder(material)
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center font-bold text-white/90 ${sizeClass} ${className}`}
      style={{ background: gradient }}
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}
