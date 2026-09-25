import { useEffect } from 'react'
import PageHeader from '../components/layout/PageHeader'
import { handleHashLinkClick, scrollToAndHighlight } from '../lib/scrollHighlight'

type Accent = 'blue' | 'violet' | 'emerald' | 'amber'

const DOT_CLASS: Record<Accent, string> = {
  blue: 'bg-blue-500 dark:bg-blue-400',
  violet: 'bg-violet-500 dark:bg-violet-400',
  emerald: 'bg-emerald-500 dark:bg-emerald-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
}

const GROUP_LABEL_CLASS =
  'px-1 pb-1.5 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400 first:pt-0'

// よくある操作（案2の「タスク指向」の良さを、案1の画面カタログへのリンク集として薄く添える。
// 2026-09-25、ユーザー承認済みの折衷案。手順の実体は下の画面カード側にのみ持たせ、ここは
// 「どの画面を見ればよいか」の道しるべに徹する。画面名・ボタン文言が変わってもここは直さずに済む）。
const QUICK_TASKS: { label: string; anchor: string }[] = [
  { label: '教材を作りたい', anchor: '#help-material-edit' },
  { label: '必修教材を配信したい', anchor: '#help-assignments' },
  { label: '受講者の進捗を確認したい', anchor: '#help-dashboard' },
  { label: '手動採点をしたい', anchor: '#help-grading' },
  { label: 'Slackで受講リマインドを送りたい', anchor: '#help-project-management' },
  { label: 'ユーザーのロール・有効無効を管理したい', anchor: '#help-admin' },
  { label: 'Claude Codeで教材を作りたい', anchor: '#help-profile' },
  { label: '学習履歴を整理したい', anchor: '#help-my-report' },
]

interface HelpEntry {
  id: string
  accent: Accent
  title: string
  sub?: string
  purpose: string
  steps: string[]
  who: string
}

// サイドバーのナビ項目と同じ並び順・グループ配色（Sidebar.tsxのNAV_ITEMS参照）。
// 画面が増えた・操作が変わったときは、対応するナビ項目のグループ内にこの配列へ1件追記/修正するだけでよい。
const HELP_ENTRIES: HelpEntry[] = [
  {
    id: 'help-my-learning',
    accent: 'blue',
    title: 'マイ学習',
    sub: 'ログイン後の最初の画面',
    purpose:
      '自分の必修・任意教材の進捗、期限が近い必修教材、採点結果の更新、学習履歴をまとめて確認する画面です。',
    steps: [
      '「必修・任意」タブで、期限が近い必修教材（赤枠で強調）を優先して受講する。',
      '任意教材は興味のあるものを選んで「受講を開始」。',
      '教材名・タグでその場検索して絞り込める。',
      '新しい教材を探して登録したい場合は右上の「新しい教材を探す」から教材一覧・検索へ。',
    ],
    who: '全員',
  },
  {
    id: 'help-materials-search',
    accent: 'blue',
    title: '教材一覧・検索',
    purpose: '自分が参加しているプロジェクトの公開済み教材をキーワード・タグ・区分で横断検索します。',
    steps: [
      'キーワード・タグ・必修/任意の区分で絞り込み、「検索」を押す。',
      '任意教材は「マイ学習に追加」でマイ学習にも表示されるようになる。',
      '教材を開くと目次（章・ページ）が表示され、そのまま受講できる。',
    ],
    who: '全員',
  },
  {
    id: 'help-my-report',
    accent: 'blue',
    title: '個人学習レポート',
    purpose:
      '自分（または管理しているプロジェクトのメンバー）の受講済み教材・スコア・合否をまとめて振り返る画面です。',
    steps: [
      '「AIフィードバックを生成する」で、理解不足の分野・おすすめ教材のコメントを作成できる。',
      '学習履歴の各行から「進捗リセット」（未受講に戻す。受験記録は残る）と「履歴から削除」（採点結果・AI集計から見えなくする）ができる。どちらも再受験回数の上限には影響しない。',
    ],
    who: '全員（他人の分はプロジェクト管理者・システムadminのみ閲覧可）',
  },
  {
    id: 'help-profile',
    accent: 'blue',
    title: 'プロフィール編集・Claude Code連携',
    sub: 'サイドバー下部の「プロフィール編集」から',
    purpose: '表示名・アイコンの変更に加え、Claude Codeから教材を作成・編集するためのAPIキーを発行できます。',
    steps: [
      '「APIキー（Claude Code連携）」パネルから鍵を発行する（このとき限りしか表示されないのでコピーする）。',
      '自分の端末のターミナルで、発行された鍵を使って `claude mcp add` コマンドを1回だけ実行する。',
      '以後は「Manabiに新しい教材を作って」「教材ID◯◯を直して」のように自然な言葉で依頼できる。',
    ],
    who: '全員',
  },
  {
    id: 'help-material-edit',
    accent: 'violet',
    title: '教材作成・編集',
    sub: 'プロジェクト選択 → 教材一覧 → 目次編集 → ページ編集',
    purpose: '教材の章・ページ構成の組み立て、本文・設問の入力、合否条件やAI採点の既定値を設定します。',
    steps: [
      'プロジェクトを選び、「＋新規教材を作成」（既存教材を直す場合は一覧から「編集する」）。',
      '「目次編集」タブで章・小見出し・ページを追加し、各ページの「編集する」で本文・設問を入力する。',
      '合格基準・再受験可否・再受験回数の上限を設定する。',
      '下書き保存で確認し、問題なければ「公開する」（配信設定の確認モーダルを経由）。',
      '教材が育ってきたら「問題一覧」タブで正答率の低い設問を見つけ、S-19の詳細画面で回答傾向を確認できる。',
    ],
    who: 'プロジェクトの編集者・管理者',
  },
  {
    id: 'help-grading',
    accent: 'violet',
    title: '採点',
    purpose:
      '記述式・コード記述式のうち「手動採点」設定の回答をまとめて採点するための、自分の担当教材を横断した一覧です。',
    steps: [
      '受験記録カード（受講者×提出日）をクリックすると、その回のすべての未採点設問がまとめて開く。',
      '設問ごとに正誤・フィードバックを入力すると自動保存される。',
      'すべて判定し終えたら「採点結果を送信」で受講者に公開する。',
    ],
    who: '教材の作成者、全社ライブラリ必修教材はプロジェクト管理者も可',
  },
  {
    id: 'help-assignments',
    accent: 'violet',
    title: '配信設定',
    purpose: '教材ごとに必修/任意・受講期限を設定し、対象者（プロジェクト全体または個人）を決める画面です。',
    steps: [
      '対象教材の行を選び、「プロジェクト全体に必修として配信する」または個人を追加指定する。',
      '必修にすると受講期限を設定でき、マイ学習に期限付きで表示されるようになる。',
      'アーカイブ済み教材の状態確認・復元もこの画面から行える。',
    ],
    who: '教材が属するプロジェクトの編集者・管理者、システムadmin',
  },
  {
    id: 'help-project-create',
    accent: 'emerald',
    title: 'プロジェクト作成',
    purpose: '新しいプロジェクトを作成します。作成した人が自動的にそのプロジェクトの管理者になります。',
    steps: ['プロジェクト名・説明を入力し、内容を確認してから作成する。'],
    who: '全員',
  },
  {
    id: 'help-project-management',
    accent: 'emerald',
    title: 'プロジェクト管理',
    purpose: 'プロジェクト情報の編集、メンバーの招待・ロール変更、他プロジェクトとの教材共有を行う画面です。',
    steps: [
      '「メンバー管理」タブで社員を検索して追加し、管理者/編集者/受講者のロールを設定する。',
      '「教材の共有」タブで、公開済み教材を他プロジェクトへ共有申請できる（下書きは共有不可）。',
      'Slack通知を使うには、「プロジェクト情報」タブでIncoming Webhook URLを登録し、「必修教材のリマインドをSlackに送信」を押す（個人名は含まれない）。',
      '条件を満たす（教材が0件または下書きのみ・自分以外のメンバーがいない）場合のみ「プロジェクトを削除」が有効になる。',
    ],
    who: '対象プロジェクトの管理者、システムadmin（一般メンバーは閲覧のみ）',
  },
  {
    id: 'help-dashboard',
    accent: 'emerald',
    title: '必修教材受講ダッシュボード',
    purpose: 'プロジェクト単位で必修教材の受講率・合格率・未受講者を確認し、AIによる組織向け所見を生成できます。',
    steps: [
      '担当範囲（管理者であるプロジェクト）を選択する。',
      '「必修教材のリマインドをSlackに送信」で、そのプロジェクトのSlackチャンネルへ未受講件数をまとめて通知する。',
      '「AI組織レポートを生成」で受講状況の所見コメントを作成できる。',
    ],
    who: '対象プロジェクトの管理者、システムadmin',
  },
  {
    id: 'help-admin',
    accent: 'amber',
    title: 'システム管理',
    purpose: '全社員のロール・有効/無効の管理と、AI利用状況・Slack通知などのシステム設定を行います。',
    steps: [
      '「ユーザー管理」タブでロール変更・アカウントの無効化を行う（システムadminが0人になる変更はブロックされる）。',
      '「管理者になっているプロジェクト」列から、そのままプロジェクト管理画面へ遷移できる。',
      '「システム設定」タブで、今月のAI利用状況（機能別の呼び出し件数・概算コスト）やSlack通知先を確認する。',
    ],
    who: 'システムadminのみ',
  },
]

// 画面ID（S-xx）は設計書上の識別用でしかないため、この画面でも表示しない（PageHeader.tsxと同じ方針）。
export default function HelpGuide() {
  // 直接 /help#help-xxx で開かれた場合・ジャンプ後にリロードされた場合も同じ位置へ開いて
  // スクロールする（MyLearning.tsxの#required-materials等と同じパターン。このページは
  // データ読み込みが無いためisLoadingの分岐は不要）。
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    const id = hash.slice(1)
    const el = document.getElementById(id)
    if (el instanceof HTMLDetailsElement) el.open = true
    scrollToAndHighlight(id)
  }, [])

  // ネイティブのハッシュ遷移に任せると、AppShellのスクロールコンテナがdocumentではなく
  // 入れ子のoverflow-y-autoのため挙動が不安定になる（lib/scrollHighlight.tsのコメント参照。
  // MyLearning.tsx等、既存の同一画面内リンクと同じ扱いに揃える）。また対象がアコーディオン
  // （<details>）で閉じたままだと開いても何も見えないため、遷移前に開いてからスクロールする。
  const jumpTo = (e: React.MouseEvent<HTMLAnchorElement>, anchor: string) => {
    const id = anchor.slice(1)
    const el = document.getElementById(id)
    if (el instanceof HTMLDetailsElement) el.open = true
    handleHashLinkClick(e, id)
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="ヘルプ" />
      <div className="mx-auto w-full max-w-3xl px-8 py-6">
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] dark:border-slate-800 dark:bg-slate-900">
          <span className="mr-1 font-semibold text-slate-500 dark:text-slate-300">よくある操作:</span>
          {QUICK_TASKS.map((task) => (
            <a
              key={task.anchor}
              href={task.anchor}
              onClick={(e) => jumpTo(e, task.anchor)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-600 hover:border-blue-700 hover:text-blue-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:text-blue-300"
            >
              {task.label}
            </a>
          ))}
        </div>

        {HELP_ENTRIES.map((entry, i) => {
          const prevAccent = i > 0 ? HELP_ENTRIES[i - 1].accent : null
          return (
            <div key={entry.id}>
              {entry.accent !== prevAccent && (
                <div className={GROUP_LABEL_CLASS}>
                  {entry.accent === 'blue' && '受講する'}
                  {entry.accent === 'violet' && '教材を作る'}
                  {entry.accent === 'emerald' && 'プロジェクトを運営する'}
                  {entry.accent === 'amber' && 'システム管理'}
                </div>
              )}
              <details
                id={entry.id}
                className="mb-2.5 scroll-mt-4 rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <summary className="flex cursor-pointer items-center gap-2.5 px-4 py-3">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${DOT_CLASS[entry.accent]}`} />
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{entry.title}</span>
                  {entry.sub && <span className="text-xs text-slate-400">— {entry.sub}</span>}
                </summary>
                <div className="border-t border-slate-100 px-4 py-3.5 dark:border-slate-800">
                  <p className="mb-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                    {entry.purpose}
                  </p>
                  <ol className="mb-3 ml-5 list-decimal space-y-1.5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
                    {entry.steps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                  <span className="inline-block rounded-sm border border-slate-200 px-2 py-0.5 text-[11px] text-slate-400 dark:border-slate-700 dark:text-slate-500">
                    対象: {entry.who}
                  </span>
                </div>
              </details>
            </div>
          )
        })}
      </div>
    </div>
  )
}
