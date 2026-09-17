import type { ReactNode } from 'react'

// 色分けラベル（詳細設計書2.1.2節）。variantは使う場所が増えるたびに追加する。
// 現状: 'published' / 'draft' / 'archived'（教材のstatus表示、S-14）、'admin' / 'editor' / 'learner'（プロジェクトのローカルロール表示、S-05）、
// 'required' / 'optional'（教材の区分表示、S-03）、'ai-warning' / 'ai-info'（AIレビュー結果の重要度、S-05）、
// 'complete' / 'overdue' / 'overdue-critical'（受講完了・期限接近・期限超過の強調表示、S-02。日付を含む
// 動的な文言のためchildrenで上書きする。'overdue-critical'は期限を過ぎたものだけに使う濃色バッジ。2026-09-17新設）、
// 'member-active' / 'member-invited' / 'member-declined'（プロジェクトメンバーの参加状態、S-12）、
// 'project-active' / 'project-stopped'（プロジェクト自体の状態、S-11・S-12の「自分の全プロジェクト一覧」）、
// 'share-pending' / 'share-accepted'（教材のプロジェクト間共有の状態、S-12教材の共有タブ。F-26）、
// 'user-active' / 'user-inactive'（システムアカウントの有効/無効、S-10ユーザー管理タブ）
// 'passed' / 'failed' / 'in-progress'（S-09個人学習レポートの学習履歴テーブル、教材ごとの直近試行結果）
// ダーク時は面（背景）を明るくして目立たせるのではなく、背景は控えめな濃色のまま、
// 文字だけを明るくして読ませる（2026-09-17、ユーザー指摘。一度背景を明るくしたところ
// 「白い箱が浮く」不具合の再発だと指摘されたため、背景は抑えて文字色側で解決する方針に変更）。
const VARIANT_CLASSES: Record<string, string> = {
  published: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-800',
  draft: 'bg-slate-100 text-slate-400 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  archived: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700',
  admin: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-800',
  editor: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800',
  learner: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  required: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800',
  optional: 'bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  'ai-warning': 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800',
  'ai-info': 'bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  complete: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-800',
  overdue: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800',
  'overdue-critical': 'bg-red-600 text-white border-red-700 dark:bg-red-700 dark:border-red-600',
  'member-active': 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-800',
  'member-invited': 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800',
  'member-declined': 'bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  'project-active': 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-800',
  'project-stopped': 'bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  'share-pending': 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800',
  'share-accepted': 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-800',
  'user-active': 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-800',
  'user-inactive': 'bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  passed: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-800',
  failed: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800',
  'in-progress': 'bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  'not-started': 'bg-slate-50 text-slate-400 border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700',
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
  passed: '合格',
  failed: '不合格',
  'in-progress': '受講中',
  'not-started': '未受講',
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
      className={`inline-block rounded border px-2 py-0.5 text-[12.5px] font-semibold ${VARIANT_CLASSES[variant]}`}
    >
      {children ?? VARIANT_LABELS[variant]}
    </span>
  )
}
