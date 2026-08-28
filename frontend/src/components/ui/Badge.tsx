// 色分けラベル（詳細設計書2.1.2節）。variantは使う場所が増えるたびに追加する。
// 現状: 'published' / 'draft' / 'archived'（教材のstatus表示、S-14）、'admin' / 'editor' / 'learner'（プロジェクトのローカルロール表示、S-05）
const VARIANT_CLASSES: Record<string, string> = {
  published: 'bg-green-50 text-green-700 border-green-200',
  draft: 'bg-slate-100 text-slate-400 border-slate-300',
  archived: 'bg-slate-50 text-slate-500 border-slate-200',
  admin: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  editor: 'bg-blue-50 text-blue-700 border-blue-200',
  learner: 'bg-slate-100 text-slate-600 border-slate-300',
}

const VARIANT_LABELS: Record<string, string> = {
  published: '公開中',
  draft: '下書き',
  archived: 'アーカイブ済み',
  admin: '管理者',
  editor: '編集者',
  learner: '受講者',
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
