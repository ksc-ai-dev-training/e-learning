import { useState } from 'react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Select from '../components/ui/Select'
import TextInput from '../components/ui/TextInput'
import { useMe } from '../hooks/useMe'
import { useUsers } from '../hooks/useUsers'
import { formatDateJst } from '../lib/datetime'
import { ApiError } from '../lib/api'
import { updateUser } from '../lib/userActions'
import type { Role } from '../types'

const TABS = [
  { key: 'users', label: 'ユーザー管理' },
  { key: 'settings', label: 'システム設定' },
] as const
type TabKey = (typeof TABS)[number]['key']

// S-10 管理（詳細設計書4.12節）。adminのみアクセス可能。
// 「ユーザー管理」タブ（A-53/A-54）を実装済み。「システム設定」タブ（AI利用状況・Slack通知・
// 猶予期間、A-55〜A-58）は次回以降に対応する準備中の案内のみとする。
export default function AdminSettings() {
  const { me, isLoading: meLoading } = useMe()
  const [activeTab, setActiveTab] = useState<TabKey>('users')

  if (meLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (!me || me.role !== 'admin') {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="管理" />
        <div className="px-8 py-6">
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            この画面はシステム管理者のみ利用できます。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="管理" />
      <div className="px-8 py-6">
        <div className="mb-5 flex gap-1 border-b border-slate-200" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                activeTab === tab.key
                  ? 'border-blue-800 text-blue-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'users' && <UsersTab myUserId={me.id} />}
        {activeTab === 'settings' && (
          <p className="text-sm text-slate-400">
            システム設定（AI利用状況・Slack通知・プロジェクト所属の猶予期間）は準備中です。次回以降のバージョンで対応予定です。
          </p>
        )}
      </div>
    </div>
  )
}

function UsersTab({ myUserId }: { myUserId: number }) {
  const [query, setQuery] = useState('')
  const { users, isLoading, mutate } = useUsers(query)
  const [rowError, setRowError] = useState<string | null>(null)

  const handleRoleChange = async (userId: number, role: Role) => {
    setRowError(null)
    try {
      await updateUser(userId, { role })
      await mutate()
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : 'ロールの変更に失敗しました')
    }
  }

  const handleToggleActive = async (userId: number, nextActive: boolean) => {
    setRowError(null)
    try {
      await updateUser(userId, { is_active: nextActive })
      await mutate()
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : '状態の変更に失敗しました')
    }
  }

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        全社員のロール（一般/システム管理者）と有効/無効を管理します。自分自身の降格・無効化はできません。システム管理者が最後の1人になる変更もできません。
      </p>

      <div className="mb-3 max-w-xs">
        <TextInput
          placeholder="氏名・メールアドレスで検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {rowError && <p className="mb-3 text-sm text-red-600">{rowError}</p>}

      {isLoading ? (
        <p className="text-sm text-slate-400">読み込み中...</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-normal">氏名</th>
                <th className="px-3 py-2 font-normal">メールアドレス</th>
                <th className="px-3 py-2 font-normal">ロール</th>
                <th className="px-3 py-2 font-normal">状態</th>
                <th className="px-3 py-2 font-normal">登録日</th>
                <th className="px-3 py-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-400">
                    該当するユーザーがいません。
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = u.id === myUserId
                  return (
                    <tr key={u.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 text-slate-800">
                        {u.name}
                        {isSelf && <span className="ml-1 text-xs text-slate-400">（あなた）</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{u.email}</td>
                      <td className="px-3 py-2">
                        <Select
                          value={u.role}
                          disabled={isSelf}
                          onChange={(v) => handleRoleChange(u.id, v as Role)}
                          options={[
                            { value: 'member', label: '一般' },
                            { value: 'admin', label: 'システム管理者' },
                          ]}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={u.is_active ? 'user-active' : 'user-inactive'} />
                      </td>
                      <td className="px-3 py-2 text-slate-500">{formatDateJst(u.created_at)}</td>
                      <td className="px-3 py-2">
                        {isSelf ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u.id, !u.is_active)}
                            className={`text-xs font-semibold hover:underline ${
                              u.is_active ? 'text-red-700' : 'text-blue-700'
                            }`}
                          >
                            {u.is_active ? '無効化' : '有効化'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
