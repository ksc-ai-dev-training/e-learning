import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import TextInput from '../components/ui/TextInput'
import { useAiUsage } from '../hooks/useAiUsage'
import { useMe } from '../hooks/useMe'
import { useSettings } from '../hooks/useSettings'
import { useUsers } from '../hooks/useUsers'
import { formatDateJst } from '../lib/datetime'
import { ApiError } from '../lib/api'
import { resetSettings, updateSettings } from '../lib/settingsActions'
import { updateUser } from '../lib/userActions'
import type { AiUsageByFeature, Role } from '../types'

const AI_FEATURE_LABELS: Record<AiUsageByFeature['feature'], string> = {
  material_review: '教材AIレビュー（F-08）',
  grading: 'AI記述式採点（F-20）',
  personal_feedback: 'AI個人フィードバック（F-22）',
  org_report: 'AI組織レポート（F-23）',
}

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

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
        {activeTab === 'settings' && <SystemSettingsTab />}
      </div>
    </div>
  )
}

function UsersTab({ myUserId }: { myUserId: number }) {
  const navigate = useNavigate()
  const { mutate: mutateMe } = useMe()
  const [query, setQuery] = useState('')
  const { users, isLoading, mutate } = useUsers(query)
  const [rowError, setRowError] = useState<string | null>(null)
  // ロール変更は誤操作防止のため自動保存にせず、選択した値をここに保持しておき「保存」を
  // 押すまで反映しない（2026-09-16、ユーザー要望）。保存中は行ごとにボタンを無効化する。
  const [pendingRoles, setPendingRoles] = useState<Record<number, Role>>({})
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set())

  const selectPendingRole = (userId: number, role: Role) => {
    setPendingRoles((prev) => ({ ...prev, [userId]: role }))
  }
  const cancelPendingRole = (userId: number) => {
    setPendingRoles((prev) => {
      const next = { ...prev }
      delete next[userId]
      return next
    })
  }

  const saveRole = async (userId: number) => {
    const role = pendingRoles[userId]
    if (role === undefined) return
    setRowError(null)
    setSavingIds((prev) => new Set(prev).add(userId))
    try {
      await updateUser(userId, { role })
      cancelPendingRole(userId)
      // 自分自身をsystem管理者から降格した場合、この一覧自体がsystem管理者専用（GET /api/users
      // はrole='admin'を要求）のため、通常どおりmutate()で再取得すると403になり、画面には
      // 保存前の古い状態が残り続けてしまう（保存自体は成功しているのに反映されて見えない）。
      // useMe()を更新してこの画面から退出させることで対処する（2026-09-16、自己降格を許可した
      // ことで新たに発生する状態のため、実機確認で発見）。navigate()を先に呼び、この画面が
      // アンマウントされた後にmutateMe()するようにする（逆順だと、useMe()の更新がこの画面の
      // 「システム管理者のみ利用できます」ガードに一瞬引っかかってから遷移する可能性がある）。
      if (userId === myUserId && role !== 'admin') {
        navigate('/')
        await mutateMe()
        return
      }
      await mutate()
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : 'ロールの変更に失敗しました')
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
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
        全社員のロール（一般/システム管理者）と有効/無効を管理します。ロールは選択後「保存」を押すまで反映されません。自分自身の降格も、他に有効なシステム管理者が1人以上いれば行えます（自分自身の無効化はできません）。システム管理者が不在になる変更はできません。
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
                <th className="px-3 py-2 font-normal">管理者になっているプロジェクト</th>
                <th className="px-3 py-2 font-normal">登録日</th>
                <th className="px-3 py-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-sm text-slate-400">
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
                          value={pendingRoles[u.id] ?? u.role}
                          disabled={savingIds.has(u.id)}
                          onChange={(v) => selectPendingRole(u.id, v as Role)}
                          options={[
                            { value: 'member', label: '一般' },
                            { value: 'admin', label: 'システム管理者' },
                          ]}
                        />
                        {pendingRoles[u.id] !== undefined && pendingRoles[u.id] !== u.role && (
                          <div className="mt-1 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => saveRole(u.id)}
                              disabled={savingIds.has(u.id)}
                              className="text-xs font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
                            >
                              {savingIds.has(u.id) ? '保存中...' : '保存'}
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelPendingRole(u.id)}
                              disabled={savingIds.has(u.id)}
                              className="text-xs text-slate-400 hover:underline"
                            >
                              取消
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={u.is_active ? 'user-active' : 'user-inactive'} />
                      </td>
                      <td className="px-3 py-2">
                        {/* デプロイ直後など、この列が無い旧レスポンスがまだ残っている一瞬でも
                            落ちないようnull合体で防御する（2026-09-09、ローカル動作確認中に
                            バックエンド再起動前のキャッシュで実際に発生したクラッシュを踏まえて追加） */}
                        {(u.admin_projects ?? []).length === 0 ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {(u.admin_projects ?? []).slice(0, 3).map((p) => (
                              <Link
                                key={p.id}
                                to={`/projects/${p.id}/manage`}
                                className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 hover:underline"
                              >
                                {p.name}
                              </Link>
                            ))}
                            {(u.admin_projects ?? []).length > 3 && (
                              <span className="text-[11px] text-slate-400">
                                他{(u.admin_projects ?? []).length - 3}件
                              </span>
                            )}
                          </div>
                        )}
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

function SystemSettingsTab() {
  const [month, setMonth] = useState(currentYearMonth())
  const { usage, isLoading, error } = useAiUsage(month)
  const { settings, mutate: mutateSettings } = useSettings()

  const [form, setForm] = useState({ project_leave_grace_period_days: 30 })
  useEffect(() => {
    if (settings) {
      setForm({
        project_leave_grace_period_days: settings.project_leave_grace_period_days,
      })
    }
  }, [settings])

  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const handleSave = async () => {
    setSaveError(null)
    setSaveMessage(null)
    setSaving(true)
    try {
      await updateSettings(form)
      await mutateSettings()
      setSaveMessage('設定を保存しました')
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : '設定の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const [resetting, setResetting] = useState(false)
  const handleReset = async () => {
    if (!window.confirm('システム設定を初期状態に戻します。よろしいですか？')) return
    setSaveError(null)
    setSaveMessage(null)
    setResetting(true)
    try {
      await resetSettings()
      await mutateSettings()
      setSaveMessage('初期状態に戻しました')
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : '初期化に失敗しました')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">AI利用設定</h3>
      <div className="mb-6 max-w-2xl rounded-md border border-slate-200 p-4">
        <label className="mb-1 block text-xs font-semibold text-slate-600">機能別の使用モデル</label>
        {settings ? (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-normal">機能</th>
                  <th className="px-3 py-2 font-normal">使用モデル</th>
                  <th className="px-3 py-2 font-normal">reasoning effort</th>
                </tr>
              </thead>
              <tbody>
                {settings.ai_models.map((m) => (
                  <tr key={m.feature} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2 text-slate-800">{AI_FEATURE_LABELS[m.feature]}</td>
                    <td className="px-3 py-2 text-slate-700">{m.model}</td>
                    <td className="px-3 py-2 text-slate-500">{m.reasoning_effort ?? '（既定）'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">読み込み中...</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          機能ごとに固定しており、変更はできません。AI採点（F-20）は学習者の合否に直結するため正確性を優先してgpt-4o-miniを、それ以外の要約・所見系の機能はコスト最優先でgpt-5-nano（reasoning
          effortを絞って安定化）を使用しています。
        </p>
      </div>

      <h3 className="mb-2 text-sm font-semibold text-slate-700">今月のAI利用状況</h3>
      <p className="mb-4 text-xs text-slate-500">
        機能別（F-08教材AIレビュー・F-20 AI記述式採点・F-22〜F-23）の呼び出し件数・トークン数・概算コストの内訳です。教材の作成・修正（F-05、Claude Code CLI連携）は利用者本人の契約で課金されるため、この集計には含まれません。
      </p>

      <div className="mb-4 max-w-[160px]">
        <TextInput type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">読み込み中...</p>
      ) : error ? (
        <p className="text-sm text-red-600">取得に失敗しました。</p>
      ) : usage ? (
        <>
          <div className="mb-4 grid max-w-2xl grid-cols-4 gap-3">
            <div className="rounded-md border border-slate-200 p-3">
              <div className="text-xs text-slate-500">呼び出し件数</div>
              <div className="text-lg font-semibold text-slate-800">{usage.total.count.toLocaleString()}</div>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <div className="text-xs text-slate-500">入力トークン</div>
              <div className="text-lg font-semibold text-slate-800">{usage.total.input_tokens.toLocaleString()}</div>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <div className="text-xs text-slate-500">出力トークン</div>
              <div className="text-lg font-semibold text-slate-800">{usage.total.output_tokens.toLocaleString()}</div>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <div className="text-xs text-slate-500">概算コスト</div>
              <div className="text-lg font-semibold text-slate-800">¥{Math.round(usage.total.cost_jpy).toLocaleString()}</div>
            </div>
          </div>

          {usage.by_feature.length === 0 ? (
            <p className="text-sm text-slate-400">この月のAI利用実績はありません。</p>
          ) : (
            <div className="max-w-2xl overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-3 py-2 font-normal">機能</th>
                    <th className="px-3 py-2 font-normal text-right">呼び出し件数</th>
                    <th className="px-3 py-2 font-normal text-right">入力トークン</th>
                    <th className="px-3 py-2 font-normal text-right">出力トークン</th>
                    <th className="px-3 py-2 font-normal text-right">概算コスト</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.by_feature.map((f) => (
                    <tr key={f.feature} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 text-slate-800">{AI_FEATURE_LABELS[f.feature] ?? f.feature}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{f.count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{f.input_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{f.output_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-slate-600">¥{Math.round(f.cost_jpy).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      <p className="mb-6 max-w-2xl rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        Slack通知（F-12）は、利用者本人がプロフィール編集（S-15）で個別に連携する方式に変更されました。システム設定としてのWebhook URL設定はありません。
      </p>

      <h3 className="mb-2 text-sm font-semibold text-slate-700">プロジェクト所属の猶予期間</h3>
      <div className="mb-6 max-w-2xl rounded-md border border-slate-200 p-4">
        <label className="mb-1 block text-xs font-semibold text-slate-600">離任後の閲覧アクセス継続日数</label>
        <div className="flex items-center gap-2">
          <TextInput
            type="number"
            min={0}
            max={365}
            step={1}
            className="w-24"
            value={form.project_leave_grace_period_days}
            onChange={(e) =>
              setForm((f) => ({ ...f, project_leave_grace_period_days: Number(e.target.value) }))
            }
          />
          <span className="text-xs text-slate-500">日</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          プロジェクト管理者がメンバーを削除した場合も、この日数の間は旧プロジェクトの教材を閲覧できます。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="primary" disabled={saving} onClick={handleSave}>
          {saving ? '保存中...' : '設定を保存'}
        </Button>
        <Button type="button" variant="secondary" disabled={resetting} onClick={handleReset}>
          {resetting ? '初期化中...' : '初期状態に戻す'}
        </Button>
        {saveMessage && <span className="text-sm text-green-700">{saveMessage}</span>}
        {saveError && <span className="text-sm text-red-600">{saveError}</span>}
      </div>
    </div>
  )
}
