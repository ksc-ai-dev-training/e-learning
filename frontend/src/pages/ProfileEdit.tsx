import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Panel from '../components/ui/Panel'
import { useMe } from '../hooks/useMe'

// S-15 プロフィール編集。現時点では基本的なアカウント情報の表示のみを扱う（アイコン変更・
// 所属プロジェクト一覧・招待応答は未実装。画面モックアップ参照）。Slack連携（F-12）は
// プロジェクト単位のWebhook通知に置き換えたため、本人ごとの連携UIは撤去した（2026-09-04）。
export default function ProfileEdit() {
  const { me } = useMe()

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
      </div>
    </div>
  )
}
