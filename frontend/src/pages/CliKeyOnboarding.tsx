import { useState } from 'react'
import Button from '../components/ui/Button'
import { issueCliKey, dismissCliKeyPrompt } from '../lib/cliKeyActions'
import { ApiError } from '../lib/api'

// 初回ログイン直後に一度だけ表示する、Claude Code連携（F-05・MCPサーバ）用APIキーの
// セルフ発行案内画面。App.tsxがAppShellの外側（通常画面が無い状態）で単独の画面として描画する。
// 見た目の約束事はS-05公開確認モーダル・UnsavedChangesModalと同じ
// （fixed inset-0 z-50 flex items-center justify-center bg-black/40 + 白いカード）だが、
// この時点では下に通常画面が無いため、オーバーレイではなく画面いっぱいの単独ページとして表示する。
export default function CliKeyOnboarding({ onDone }: { onDone: () => void }) {
  const [issued, setIssued] = useState<{ token: string; manabi_url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleIssue = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await issueCliKey()
      setIssued(result)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '発行に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const handleSkip = async () => {
    setBusy(true)
    setError(null)
    try {
      await dismissCliKeyPrompt()
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '処理に失敗しました')
      setBusy(false)
    }
  }

  const handleCopy = async () => {
    if (!issued) return
    await navigator.clipboard.writeText(issued.token)
    setCopied(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-lg rounded-md bg-white p-6 shadow-lg">
        {!issued ? (
          <>
            <h1 className="mb-2 text-base font-bold text-slate-900">Claude Code連携用のAPIキー</h1>
            <p className="mb-6 text-sm text-slate-600">
              Claude Codeで教材を作成・編集する場合に使う鍵です。今使わない場合は、あとから
              プロフィール画面でいつでも発行できます。
            </p>
            {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={handleSkip} disabled={busy}>
                後で設定する
              </Button>
              <Button onClick={handleIssue} disabled={busy}>
                {busy ? '発行中...' : '発行する'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-base font-bold text-slate-900">APIキーを発行しました</h1>
            <p className="mb-3 text-sm text-slate-600">
              このキーは今だけ表示されます。Claude CodeのMCP設定に登録してください。
            </p>
            <div className="mb-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                {issued.token}
              </code>
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? 'コピーしました' : 'コピー'}
              </Button>
            </div>
            <p className="mb-6 text-xs text-slate-500">
              接続先: <code>{issued.manabi_url}/mcp</code>
              <br />
              このキーはAuthorizationヘッダー（Bearerトークン）として設定してください。
            </p>
            <div className="flex justify-end">
              <Button onClick={onDone}>続ける</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
