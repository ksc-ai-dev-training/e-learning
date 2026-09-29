// サムネイル画像が未設定の教材向け、機械生成プレースホルダー（2026-09-28新設）。
// 教材IDから決定的に色の組み合わせを選ぶ（同じ教材は常に同じ見た目になる）。タグ等の意味的な
// 判定はせず、あくまで「一覧をパッと見て区別しやすくする」ための色分けに留める。

const GRADIENTS = [
  'linear-gradient(135deg, #4338ca, #1e40af)',
  'linear-gradient(135deg, #0f766e, #0e7490)',
  'linear-gradient(135deg, #b91c1c, #9d174d)',
  'linear-gradient(135deg, #c2410c, #a16207)',
  'linear-gradient(135deg, #0369a1, #0e7490)',
  'linear-gradient(135deg, #1d4ed8, #3730a3)',
  'linear-gradient(135deg, #4d7c0f, #3f6212)',
  'linear-gradient(135deg, #7e22ce, #5b21b6)',
]

export interface ThumbnailPlaceholder {
  gradient: string
  initial: string
}

export function getThumbnailPlaceholder(material: { id: number; title: string }): ThumbnailPlaceholder {
  const gradient = GRADIENTS[material.id % GRADIENTS.length]
  const initial = material.title.trim().slice(0, 1) || '?'
  return { gradient, initial }
}
