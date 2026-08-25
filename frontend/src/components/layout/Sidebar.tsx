import { Link, useLocation } from 'react-router'
import { apiFetch } from '../../lib/api'
import { useMe } from '../../hooks/useMe'
import type { Me } from '../../types'

// サイドバー共通コンポーネント（詳細設計書2.1.1節）。全認証後画面で共通。
// 現状はS-13のみ実装のため、他のメニュー項目は画面ができるまで非活性表示にする。
const NAV_ITEMS = [
  { href: '/', label: 'マイ学習', implemented: false },
  { href: '/materials', label: '教材一覧・検索', implemented: false },
  { href: '/materials/edit-projects', label: '教材編集', implemented: true },
  { href: '/reports/me', label: '個人学習レポート', implemented: false },
  { href: '/projects/new', label: 'プロジェクト作成', implemented: false },
  { href: '/projects/manage', label: 'プロジェクト管理', implemented: false },
]

export default function Sidebar({ me }: { me: Me }) {
  const location = useLocation()
  const { mutate } = useMe()

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    await mutate()
  }

  return (
    <aside className="flex h-screen w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-4">
        <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-md bg-blue-900 text-sm font-bold text-white">
          M
        </div>
        <div>
          <div className="text-[15px] font-bold leading-tight">Manabi</div>
          <div className="text-[10.5px] leading-tight text-slate-400">社内学習管理システム</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold tracking-wide text-slate-400">
          メニュー
        </div>
        {NAV_ITEMS.map((item) =>
          item.implemented ? (
            <Link
              key={item.href}
              to={item.href}
              className={`mb-0.5 flex h-[34px] items-center rounded-md px-2.5 font-medium ${
                location.pathname === item.href
                  ? 'bg-blue-50 font-semibold text-blue-900'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.href}
              className="mb-0.5 flex h-[34px] cursor-default items-center rounded-md px-2.5 font-medium text-slate-300"
              title="未実装"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-900">
            {me.name.slice(0, 1)}
          </span>
          <div>
            <div className="text-[12.5px] font-semibold leading-tight">{me.name}</div>
            <div className="text-[10.5px] leading-tight text-slate-400">{me.email}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="mt-2.5 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          ログアウト
        </button>
      </div>
    </aside>
  )
}
