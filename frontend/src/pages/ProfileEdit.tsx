import { useState } from 'react'
import { useSearchParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Panel from '../components/ui/Panel'
import { useMe } from '../hooks/useMe'
import { useSlackStatus } from '../hooks/useSlackStatus'
import { ApiError } from '../lib/api'
import { formatDateTimeJst } from '../lib/datetime'
import { disconnectSlack } from '../lib/slackActions'

const SLACK_ERROR_MESSAGES: Record<string, string> = {
  invalid_request: '連携に失敗しました。もう一度お試しください。',
  access_denied: '連携がキャンセルされました。',
}

// S-15 プロフィール編集。現時点ではSlack連携（F-12）と基本的なアカウント情報のみを扱う
// （アイコン変更・所属プロジェクト一覧・招待応答は未実装。画面モックアップ参照）。
export default function ProfileEdit() {
  const { me } = useMe()
  const { status, isLoading, mutate } = useSlackStatus()
  const [searchParams] = useSearchParams()
  const slackError = searchParams.get('slack_error')
  const justConnected = searchParams.get('slack') === 'connected'
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

  const handleDisconnect = async () => {
    setDisconnectError(null)
    setDisconnecting(true)
    try {
      await disconnectSlack()
      await mutate()
    } catch (e) {
      setDisconnectError(e instanceof ApiError ? e.message : '連携解除に失敗しました')
    } finally {
      setDisconnecting(false)
    }
  }

  if (!me) return null

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="プロフィール編集" />
      <div className="max-w-2xl px-8 py-6">
        <Panel title="アカウント情報">
          <div className="flex flex-col gap-3 p-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="w-20 flex-shrink-0 text-xs font-semibold text-slate-500">表示名</span>
              <span className="text-slate-800">{me.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-20 flex-shrink-0 text-xs font-semibold text-slate-500">メールアドレス</span>
              <span className="text-slate-800">{me.email}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-20 flex-shrink-0 text-xs font-semibold text-slate-500">システムロール</span>
              <Badge variant={me.role === 'admin' ? 'admin' : 'learner'} />
            </div>
          </div>
        </Panel>

        <div className="mt-5">
          <Panel title="Slack連携">
            <div className="flex flex-col gap-3 p-4">
              <p className="text-xs text-slate-500">
                連携すると、必修教材の受講期限が近い・過ぎている場合に、プロジェクト管理者からSlackで個別にリマインドを受け取れるようになります。連携しない場合、リマインドは届きません。
              </p>

              {justConnected && (
                <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  Slack連携が完了しました。
                </p>
              )}
              {slackError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {SLACK_ERROR_MESSAGES[slackError] ?? '連携に失敗しました。もう一度お試しください。'}
                </p>
              )}
              {disconnectError && <p className="text-sm text-red-600">{disconnectError}</p>}

              {isLoading ? (
                <p className="text-sm text-slate-400">読み込み中...</p>
              ) : !status?.configured ? (
                <p className="text-sm text-slate-400">現在Slack連携は利用できません（システム側の設定が未完了です）。</p>
              ) : status.connected ? (
                <div className="flex items-center gap-3">
                  <Badge variant="connected" />
                  {status.connected_at && (
                    <span className="text-xs text-slate-500">
                      連携日: {formatDateTimeJst(status.connected_at)}
                    </span>
                  )}
                  <Button variant="secondary" onClick={handleDisconnect} disabled={disconnecting} className="ml-auto">
                    {disconnecting ? '解除中...' : '連携を解除'}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Badge variant="not-connected" />
                  <a
                    href="/api/slack/connect"
                    className="ml-auto rounded-md bg-blue-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    Slack連携する
                  </a>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
