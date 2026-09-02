import type { ReactNode } from 'react'

// 色分けラベル（詳細設計書2.1.2節）。variantは使う場所が増えるたびに追加する。
// 現状: 'published' / 'draft' / 'archived'（教材のstatus表示、S-14）、'admin' / 'editor' / 'learner'（プロジェクトのローカルロール表示、S-05）、
// 'required' / 'optional'（教材の区分表示、S-03）、'ai-warning' / 'ai-info'（AIレビュー結果の重要度、S-05）、
// 'complete' / 'overdue'（受講完了・期限接近の強調表示、S-02。日付を含む動的な文言のためchildrenで上書きする）、
// 'member-active' / 'member-invited' / 'member-declined'（プロジェクトメンバーの参加状態、S-12）、
// 'project-active' / 'project-stopped'（プロジェクト自体の状態、S-11・S-12の「自分の全プロジェクト一覧」）、
// 'share-pending' / 'share-accepted'（教材のプロジェクト間共有の状態、S-12教材の共有タブ。F-26）、
// 'user-active' / 'user-inactive'（システムアカウントの有効/無効、S-10ユーザー管理タブ）
const VARIANT_CLASSES: Record<string, string> = {
  published: 'bg-green-50 text-green-700 border-green-200',
  draft: 'bg-slate-100 text-slate-400 border-slate-300',
  archived: 'bg-slate-50 text-slate-500 border-slate-200',
  admin: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  editor: 'bg-blue-50 text-blue-700 border-blue-200',
  learner: 'bg-slate-100 text-slate-600 border-slate-300',
  required: 'bg-red-50 text-red-700 border-red-200',
  optional: 'bg-slate-100 text-slate-500 border-slate-300',
  'ai-warning': 'bg-amber-50 text-amber-700 border-amber-200',
  'ai-info': 'bg-slate-100 text-slate-500 border-slate-300',
  complete: 'bg-green-50 text-green-700 border-green-200',
  overdue: 'bg-red-50 text-red-700 border-red-200',
  'member-active': 'bg-green-50 text-green-700 border-green-200',
  'member-invited': 'bg-amber-50 text-amber-700 border-amber-200',
  'member-declined': 'bg-slate-100 text-slate-500 border-slate-300',
  'project-active': 'bg-green-50 text-green-700 border-green-200',
  'project-stopped': 'bg-slate-100 text-slate-500 border-slate-300',
  'share-pending': 'bg-amber-50 text-amber-700 border-amber-200',
  'share-accepted': 'bg-green-50 text-green-700 border-green-200',
  'user-active': 'bg-green-50 text-green-700 border-green-200',
  'user-inactive': 'bg-slate-100 text-slate-500 border-slate-300',
}

const VARIANT_LABELS: Record<string, string> = {
  published: '公開中',
  draft: '下書き',
  archived: 'アーカイブ済み',
  admin: '管理者',
  editor: '編集者',
  learner: '受講者',
  required: '必修',
  optional: '任意',
  'ai-warning': '指摘',
  'ai-info': '提案',
  'member-active': '参加済み',
  'member-invited': '招待中',
  'member-declined': '辞退',
  'project-active': '進行中',
  'project-stopped': '停止',
  'share-pending': '承認待ち',
  'share-accepted': '複製済み',
  'user-active': '有効',
  'user-inactive': '無効',
}

export default function Badge({
  variant,
  children,
}: {
  variant: keyof typeof VARIANT_CLASSES
  children?: ReactNode
}) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold ${VARIANT_CLASSES[variant]}`}
    >
      {children ?? VARIANT_LABELS[variant]}
    </span>
  )
}
