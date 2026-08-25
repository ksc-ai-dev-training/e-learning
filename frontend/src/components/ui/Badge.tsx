// 色分けラベル（詳細設計書2.1.2節）。variantは使う場所が増えるたびに追加する。
// 現状: 'published' / 'draft'（教材のstatus表示、S-14）
const VARIANT_CLASSES: Record<string, string> = {
  published: 'bg-green-50 text-green-700 border-green-200',
  draft: 'bg-slate-100 text-slate-400 border-slate-300',
}

const VARIANT_LABELS: Record<string, string> = {
  published: '公開中',
  draft: '下書き',
}

export default function Badge({ variant }: { variant: keyof typeof VARIANT_CLASSES }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold ${VARIANT_CLASSES[variant]}`}
    >
      {VARIANT_LABELS[variant]}
    </span>
  )
}
