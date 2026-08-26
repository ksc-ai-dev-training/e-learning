import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import {
  Home,
  BookOpen,
  Pencil,
  BarChart3,
  Plus,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  UserPen,
  LogOut,
} from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useMe } from '../../hooks/useMe'
import type { Me } from '../../types'

const COLLAPSED_KEY = 'manabi-sidebar-collapsed'

// サイドバー共通コンポーネント（詳細設計書2.1.1節）。全認証後画面で共通。
// 現状はS-13のみ実装のため、他のメニュー項目は画面ができるまで非活性表示にする。
const NAV_ITEMS = [
  { href: '/', label: 'マイ学習', icon: Home, implemented: false },
  { href: '/materials', label: '教材一覧・検索', icon: BookOpen, implemented: false },
  { href: '/materials/edit-projects', label: '教材編集', icon: Pencil, implemented: true },
  { href: '/reports/me', label: '個人学習レポート', icon: BarChart3, implemented: false },
  { href: '/projects/new', label: 'プロジェクト作成', icon: Plus, implemented: false },
  { href: '/projects/manage', label: 'プロジェクト管理', icon: LayoutGrid, implemented: false },
]

export default function Sidebar({ me }: { me: Me }) {
  const location = useLocation()
  const { mutate } = useMe()
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
      className={`relative flex h-screen flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50 transition-[width] duration-150 ${
        collapsed ? 'w-14' : 'w-60'
      }`}
    >
      <button
        onClick={toggle}
        title={collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
        className="absolute -right-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm hover:text-slate-700"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      <div
        className={`flex items-center border-b border-slate-200 py-4 ${
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-4'
        }`}
      >
        <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-md bg-blue-900 text-sm font-bold text-white">
          M
        </div>
        {!collapsed && (
          <div>
            <div className="text-[15px] font-bold leading-tight">Manabi</div>
            <div className="text-[10.5px] leading-tight text-slate-400">社内学習管理システム</div>
          </div>
        )}
      </div>

      <nav className={`flex-1 overflow-y-auto overflow-x-hidden p-2 ${collapsed ? 'px-1.5' : ''}`}>
        {!collapsed && (
          <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold tracking-wide text-slate-400">
            メニュー
          </div>
        )}
        {NAV_ITEMS.map((item) => {
          const body = (
            <>
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </>
          )
          const className = `mb-0.5 flex h-[34px] items-center gap-2 rounded-md font-medium ${
            collapsed ? 'justify-center px-0' : 'px-2.5'
          } ${
            item.implemented
              ? location.pathname === item.href
                ? 'bg-blue-50 font-semibold text-blue-900'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              : 'cursor-default text-slate-300'
          }`
          return item.implemented ? (
            <Link key={item.href} to={item.href} title={collapsed ? item.label : undefined} className={className}>
              {body}
            </Link>
          ) : (
            <span key={item.href} title={collapsed ? item.label : '未実装'} className={className}>
              {body}
            </span>
          )
        })}
      </nav>

      <div className={`border-t border-slate-200 py-3 ${collapsed ? 'px-1' : 'px-3'}`}>
        <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : ''}`} title={collapsed ? `${me.name}（${me.email}）` : undefined}>
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-900">
            {me.name.slice(0, 1)}
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold leading-tight">{me.name}</div>
              <div className="truncate text-[10.5px] leading-tight text-slate-400">{me.email}</div>
            </div>
          )}
        </div>
        <div className={`mt-2.5 flex flex-col gap-1.5 ${collapsed ? 'items-center' : ''}`}>
          <span
            title="プロフィール編集（未実装）"
            className={`flex h-[30px] cursor-default items-center gap-2 rounded-md border border-slate-200 bg-white text-xs text-slate-300 ${
              collapsed ? 'w-[30px] justify-center' : 'w-full px-2.5'
            }`}
          >
            <UserPen className="h-3.5 w-3.5 flex-shrink-0" />
            {!collapsed && <span>プロフィール編集</span>}
          </span>
          <button
            onClick={logout}
            title={collapsed ? 'ログアウト' : undefined}
            className={`flex h-[30px] items-center gap-2 rounded-md border border-slate-200 bg-white text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 ${
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
