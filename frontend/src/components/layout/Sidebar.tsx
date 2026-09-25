import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import {
  Home,
  BookOpen,
  Pencil,
  CircleCheckBig,
  BarChart3,
  LayoutDashboard,
  Plus,
  LayoutGrid,
  Send,
  ChevronLeft,
  ChevronRight,
  UserPen,
  LogOut,
  Settings,
  Moon,
  Sun,
  CircleHelp,
} from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useMe } from '../../hooks/useMe'
import { useTheme } from '../../lib/theme'
import type { Me } from '../../types'

const COLLAPSED_KEY = 'manabi-sidebar-collapsed'

// サイドバー共通コンポーネント（詳細設計書2.1.1節）。全認証後画面で共通。
// 現状はS-13のみ実装のため、他のメニュー項目は画面ができるまで非活性表示にする。
//
// matchは「今どのナビ項目に居るか」の判定に使う。hrefそのものとの完全一致だけでは、
// 教材編集のようにナビ項目のリンク先（S-13 /materials/edit-projects）と実際の画面遷移先
// （S-14/S-05/S-17、/projects/:id/materials配下）のURLが異なる場合にハイライトが外れて
// しまう不具合があったため、項目ごとに判定関数を持たせた（2026-08-28）。
// S-04/S-16（/materials/:id, /materials/:id/pages/:nodeId）はマイ学習・教材一覧・検索の
// どちらからも遷移しうる共通の受講画面のため、pathnameだけでは出所を判定できない。
// 遷移元はlib/backLink.tsの`from=my-learning`クエリで引き継いでいるため、matchにも
// search文字列を渡してこれを判定に使う（2026-08-31。以前はどちらのナビ項目もハイライト
// されなくなる不具合があった）。
// ほとんどの利用者（受講のみ行う一般学習者）が使うのは「マイ学習」「教材一覧・検索」
// 「個人学習レポート」の3つのため、これを先頭グループに置き、以降を教材運営（教材編集〜配信設定）・
// プロジェクト運営（プロジェクト作成・管理・必修教材受講ダッシュボード）・システム管理の
// グループに分けて、薄い区切り線とグループごとのアイコン色で視覚的にまとめる
// （2026-09-09、ユーザー指定の並び順・グループ配色。2026-09-17、S-08が「全社」スコープ廃止で
// 常にプロジェクト単位のみを扱う画面になったため、教材運営からプロジェクト運営グループへ移動）。
const ACCENT_ICON_CLASS = {
  blue: 'text-blue-500 dark:text-blue-400',
  violet: 'text-violet-500 dark:text-violet-400',
  emerald: 'text-emerald-500 dark:text-emerald-400',
  amber: 'text-amber-500 dark:text-amber-400',
} as const
// 選択中の項目の強調表示。ブロックごとにアイコン色を付けたことで、選択中を示す既存の
// 一律「薄い青背景」がどのブロックでもほぼ同じに見え、区別しづらくなっていたため、
// 選択中もブロックのアクセントカラーに合わせ、左端に太めのボーダーも付けて強調する
// （2026-09-09、ユーザー指摘）。ダーク時は薄い色背景+濃い文字だと目立たないため、
// 濃い色背景+明るい文字に反転する（2026-09-17）。
const ACCENT_ACTIVE_CLASS = {
  blue: 'border-l-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-900/60 dark:text-blue-100',
  violet: 'border-l-violet-600 bg-violet-50 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100',
  emerald: 'border-l-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100',
  amber: 'border-l-amber-600 bg-amber-50 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
} as const
type Accent = keyof typeof ACCENT_ICON_CLASS

const NAV_ITEMS = [
  {
    href: '/',
    label: 'マイ学習',
    icon: Home,
    implemented: true,
    accent: 'blue' as Accent,
    // S-04/S-16（/materials/:id、/materials/:id/pages/:nodeId）だけに絞る。以前は
    // /^\/materials\/\d+(\/|$)/という広すぎる正規表現で、S-19「設問別の回答・結果一覧」
    // （/materials/:id/questions/:qid/answers、教材編集からしか辿り着けない画面）まで
    // 誤って一致し、教材編集中なのにサイドバーの「教材一覧・検索」が光ってしまう不具合が
    // あった（2026-09-16、ユーザー報告により発見）。
    match: (p: string, search: string) => p === '/' || (/^\/materials\/\d+(\/pages\/\d+)?$/.test(p) && search.includes('from=my-learning')),
  },
  {
    href: '/materials',
    label: '教材一覧・検索',
    icon: BookOpen,
    implemented: true,
    accent: 'blue' as Accent,
    match: (p: string, search: string) => p === '/materials' || (/^\/materials\/\d+(\/pages\/\d+)?$/.test(p) && !search.includes('from=my-learning')),
  },
  {
    href: '/reports/me',
    label: '個人学習レポート',
    icon: BarChart3,
    implemented: true,
    accent: 'blue' as Accent,
    match: (p: string) => p.startsWith('/reports/'),
  },
  {
    href: '/materials/edit-projects',
    label: '教材作成・編集',
    icon: Pencil,
    implemented: true,
    accent: 'violet' as Accent,
    dividerBefore: true,
    // S-19「設問別の回答・結果一覧」（/materials/:id/questions/:qid/answers）も、教材編集の
    // 「問題一覧」タブからしか辿り着けない画面のためここに含める（2026-09-16）
    match: (p: string) =>
      p === '/materials/edit-projects' ||
      /^\/projects\/[^/]+\/materials(\/|$)/.test(p) ||
      /^\/materials\/\d+\/questions\/\d+\/answers$/.test(p),
  },
  {
    href: '/grading',
    label: '採点',
    icon: CircleCheckBig,
    implemented: true,
    accent: 'violet' as Accent,
    match: (p: string) => p === '/grading',
  },
  {
    href: '/assignments',
    label: '配信設定',
    icon: Send,
    implemented: true,
    accent: 'violet' as Accent,
    match: (p: string) => p === '/assignments',
  },
  {
    href: '/projects/new',
    label: 'プロジェクト作成',
    icon: Plus,
    implemented: true,
    accent: 'emerald' as Accent,
    dividerBefore: true,
    match: (p: string) => p === '/projects/new',
  },
  {
    href: '/projects/manage',
    label: 'プロジェクト管理',
    icon: LayoutGrid,
    implemented: true,
    accent: 'emerald' as Accent,
    match: (p: string) => p === '/projects/manage' || /^\/projects\/[^/]+\/manage(\/|$)/.test(p),
  },
  {
    href: '/dashboard',
    // S-08は「全社」スコープを廃止し、プロジェクト単位の必修教材受講状況のみを扱う画面になった
    // （2026-09-17）。従来の「受講状況ダッシュボード」という名前は全社集計も含むように読めて
    // 実態と合わないため改称した。プロジェクト単位でしかスコープを持たなくなったため、
    // グループも教材運営からプロジェクト運営（プロジェクト作成・管理と同じ配色）へ移した。
    label: '必修教材受講ダッシュボード',
    icon: LayoutDashboard,
    implemented: true,
    accent: 'emerald' as Accent,
    // プロジェクト管理者のみ閲覧できるが、「教材編集」等と同様ナビ項目自体は全員に表示し、
    // 担当プロジェクトが無い場合は画面側の空状態で案内する（2026-09-08）。
    match: (p: string) => p === '/dashboard',
  },
  {
    href: '/admin/settings',
    // 画面名自体はS-10「管理」（基本設計書4.12節）のままだが、サイドバー上は他の項目と並んだ
    // ときに「何を管理する画面か」が伝わりにくいというフィードバックを受け、表示ラベルのみ
    // 「システム管理」とした（2026-09-02）。
    label: 'システム管理',
    icon: Settings,
    implemented: true,
    accent: 'amber' as Accent,
    dividerBefore: true,
    // S-10はシステムadmin専用（基本設計書4.12節）。他の項目と異なりロールで表示自体を絞る
    adminOnly: true,
    match: (p: string) => p === '/admin/settings',
  },
  {
    href: '/help',
    // 全画面の操作方法をまとめたガイド（2026-09-25新設）。システム管理と同じamber系統の色を
    // 保ったまま全員に表示し、直前に区切り線を1本引く。システム管理の直後に置くだけで、
    // システムadmin以外（システム管理自体が非表示）には区切り線ごと1つ上のダッシュボードの
    // 下に自然に繰り上がる（ユーザー要望どおりの見え方を、追加のフィルタ処理無しで実現）。
    label: 'ヘルプ',
    icon: CircleHelp,
    implemented: true,
    accent: 'amber' as Accent,
    dividerBefore: true,
    match: (p: string) => p === '/help',
  },
]

export default function Sidebar({ me }: { me: Me }) {
  const location = useLocation()
  const { mutate } = useMe()
  const { theme, toggleTheme } = useTheme()
  // 開閉状態はlocalStorageに保存し、リロード後も維持する（keirekiのLayout.tsxと同方針）
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSED_KEY) === '1',
  )

  const toggle = () =>
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      return !c
    })

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    await mutate()
  }

  return (
    <aside
      className={`relative flex h-screen flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50 transition-[width] duration-150 dark:border-slate-800 dark:bg-slate-900 ${
        collapsed ? 'w-14' : 'w-60'
      }`}
    >
      <button
        onClick={toggle}
        title={collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
        className="absolute -right-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      <div
        className={`flex items-center border-b border-slate-200 py-4 dark:border-slate-800 ${
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-4'
        }`}
      >
        <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-md bg-blue-900 text-sm font-bold text-white">
          M
        </div>
        {!collapsed && (
          <div>
            <div className="text-[15px] font-bold leading-tight dark:text-slate-100">Manabi</div>
            <div className="text-[12px] leading-tight text-slate-400">社内学習管理システム</div>
          </div>
        )}
      </div>

      <nav className={`flex-1 overflow-y-auto overflow-x-hidden p-2 ${collapsed ? 'px-1.5' : ''}`}>
        {!collapsed && (
          <div className="px-2.5 pb-1 pt-1.5 text-[12px] font-semibold tracking-wide text-slate-400">
            メニュー
          </div>
        )}
        {NAV_ITEMS.filter((item) => !item.adminOnly || me.role === 'admin').map((item) => {
          const isActive = item.implemented && item.match(location.pathname, location.search)
          // 未選択の項目はグループごとのアイコン色でどのブロックかを分かりやすくし（2026-09-09、
          // ユーザー要望）、選択中の項目はそのブロックのアクセントカラーで強調する（左端の太い
          // ボーダー＋背景色）。以前は選択中を一律の薄い青背景だけで示していたが、複数の色を
          // 使うようになったことで見分けづらくなっていたための修正（2026-09-09、ユーザー指摘）。
          const iconAccentClass = item.implemented && !isActive ? ACCENT_ICON_CLASS[item.accent] : ''
          const body = (
            <>
              <item.icon className={`h-4 w-4 flex-shrink-0 ${iconAccentClass}`} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </>
          )
          const className = `mb-0.5 flex h-[34px] items-center gap-2 rounded-md border-l-[3px] font-medium ${
            collapsed ? 'justify-center px-0' : 'px-2.5'
          } ${
            item.implemented
              ? isActive
                ? `${ACCENT_ACTIVE_CLASS[item.accent]} font-semibold`
                : 'border-l-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              : 'border-l-transparent cursor-default text-slate-300'
          }`
          return (
            <div key={item.href}>
              {item.dividerBefore && <div className="my-1.5 border-t border-slate-200 dark:border-slate-800" />}
              {item.implemented ? (
                <Link to={item.href} title={collapsed ? item.label : undefined} className={className}>
                  {body}
                </Link>
              ) : (
                <span title={collapsed ? item.label : '未実装'} className={className}>
                  {body}
                </span>
              )}
            </div>
          )
        })}
      </nav>

      <div className={`border-t border-slate-200 py-3 dark:border-slate-800 ${collapsed ? 'px-1' : 'px-3'}`}>
        <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : ''}`} title={collapsed ? `${me.name}（${me.email}）` : undefined}>
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-900">
            {me.name.slice(0, 1)}
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold leading-tight dark:text-slate-100">{me.name}</div>
              <div className="truncate text-[12px] leading-tight text-slate-400">{me.email}</div>
            </div>
          )}
        </div>
        <div className={`mt-2.5 flex flex-col gap-1.5 ${collapsed ? 'items-center' : ''}`}>
          <Link
            to="/profile"
            title={collapsed ? 'プロフィール編集' : undefined}
            className={`flex h-[30px] items-center gap-2 rounded-md border border-slate-200 bg-white text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100 ${
              collapsed ? 'w-[30px] justify-center' : 'w-full px-2.5'
            }`}
          >
            <UserPen className="h-3.5 w-3.5 flex-shrink-0" />
            {!collapsed && <span>プロフィール編集</span>}
          </Link>
          {/* ダークモード切替（2026-09-17新設）。現時点ではサイドバー等の共通枠のみ対応済みで、
              各画面本体は今後段階的に対応する。 */}
          <button
            onClick={toggleTheme}
            title={collapsed ? (theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え') : undefined}
            className={`flex h-[30px] items-center gap-2 rounded-md border border-slate-200 bg-white text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100 ${
              collapsed ? 'w-[30px] justify-center' : 'w-full px-2.5'
            }`}
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5 flex-shrink-0" /> : <Moon className="h-3.5 w-3.5 flex-shrink-0" />}
            {!collapsed && <span>{theme === 'dark' ? 'ライトモード' : 'ダークモード'}</span>}
          </button>
          <button
            onClick={logout}
            title={collapsed ? 'ログアウト' : undefined}
            className={`flex h-[30px] items-center gap-2 rounded-md border border-slate-200 bg-white text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100 ${
              collapsed ? 'w-[30px] justify-center' : 'w-full px-2.5'
            }`}
          >
            <LogOut className="h-3.5 w-3.5 flex-shrink-0" />
            {!collapsed && <span>ログアウト</span>}
          </button>
        </div>
      </div>
    </aside>
  )
}
