import { useEffect, useState } from 'react'
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
import { resetSettings, sendSlackTest, updateSettings } from '../lib/settingsActions'
import { updateUser } from '../lib/userActions'
import type { AiModel, AiUsageByFeature, Role } from '../types'

const AI_MODEL_OPTIONS: { value: AiModel; label: string }[] = [
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5（既定）' },
  { value: 'claude-opus-5', label: 'Claude Opus 5（高精度・低速）' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5（高速・低コスト）' },
]

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const AI_FEATURE_LABELS: Record<AiUsageByFeature['feature'], string> = {
  material_review: '教材AIレビュー（F-08）',
  grading: 'AI記述式採点（F-20）',
  insight_analysis: 'AIつまずき分析（F-21）',
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

function SystemSettingsTab() {
  const [month, setMonth] = useState(currentYearMonth())
  const { usage, isLoading, error } = useAiUsage(month)
  const { settings, isLoading: settingsLoading, mutate: mutateSettings } = useSettings()

  const [form, setForm] = useState({ slack_webhook_url: '', slack_channel: '', project_leave_grace_period_days: 30 })
  useEffect(() => {
    if (settings) {
      setForm({
        slack_webhook_url: settings.slack_webhook_url,
        slack_channel: settings.slack_channel,
        project_leave_grace_period_days: settings.project_leave_grace_period_days,
      })
    }
  }, [settings])

  const [modelSaving, setModelSaving] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const handleModelChange = async (value: string) => {
    setModelError(null)
    setModelSaving(true)
    try {
      await updateSettings({ ai_model: value as AiModel })
      await mutateSettings()
    } catch (e) {
      setModelError(e instanceof ApiError ? e.message : 'AIモデルの保存に失敗しました')
    } finally {
      setModelSaving(false)
    }
  }

  const [urlError, setUrlError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const handleSave = async () => {
    setSaveError(null)
    setSaveMessage(null)
    setUrlError(null)
    if (form.slack_webhook_url && !isValidHttpUrl(form.slack_webhook_url)) {
      setUrlError('Webhook URLの形式が正しくありません')
      return
    }
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

  const [testSending, setTestSending] = useState(false)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const handleSlackTest = async () => {
    setTestMessage(null)
    setTestError(null)
    setTestSending(true)
    try {
      const res = await sendSlackTest()
      setTestMessage(res.detail)
    } catch (e) {
      setTestError(e instanceof ApiError ? e.message : 'テスト送信に失敗しました')
    } finally {
      setTestSending(false)
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
        <label className="mb-1 block text-xs font-semibold text-slate-600">利用するAIモデル（既定）</label>
        <Select
          value={settings?.ai_model ?? 'claude-sonnet-5'}
          onChange={handleModelChange}
          disabled={settingsLoading || modelSaving}
          options={AI_MODEL_OPTIONS}
          className="max-w-xs"
        />
        <p className="mt-2 text-xs text-slate-500">
          F-08・F-20〜F-23の全AI機能で共通の設定です（機能ごとに個別のモデルを割り当てる機能はありません）。選択すると即座に保存されます。
        </p>
        {modelError && <p className="mt-2 text-sm text-red-600">{modelError}</p>}
      </div>

      <h3 className="mb-2 text-sm font-semibold text-slate-700">今月のAI利用状況</h3>
      <p className="mb-4 text-xs text-slate-500">
        機能別（F-08教材AIレビュー・F-20 AI記述式採点・F-21〜F-23）の呼び出し件数・トークン数・概算コストの内訳です。教材の作成・修正（F-05、Claude Code CLI連携）は利用者本人の契約で課金されるため、この集計には含まれません。
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

      <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-700">Slack通知設定</h3>
      <div className="mb-6 max-w-2xl rounded-md border border-slate-200 p-4">
        <div className="mb-3">
          <label className="mb-1 block text-xs font-semibold text-slate-600">Webhook URL</label>
          <TextInput
            type="url"
            className="w-full max-w-md"
            placeholder="https://hooks.slack.com/services/..."
            value={form.slack_webhook_url}
            onChange={(e) => setForm((f) => ({ ...f, slack_webhook_url: e.target.value }))}
          />
          {urlError && <p className="mt-1 text-sm text-red-600">{urlError}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">通知先チャンネル</label>
          <TextInput
            type="text"
            className="max-w-[220px]"
            placeholder="#elearning-通知"
            value={form.slack_channel}
            onChange={(e) => setForm((f) => ({ ...f, slack_channel: e.target.value }))}
          />
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              disabled={testSending || !form.slack_webhook_url}
              onClick={handleSlackTest}
            >
              {testSending ? '送信中...' : 'テスト送信'}
            </Button>
            {testMessage && <span className="ml-3 text-sm text-green-700">{testMessage}</span>}
            {testError && <span className="ml-3 text-sm text-red-600">{testError}</span>}
          </div>
        </div>
      </div>

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
