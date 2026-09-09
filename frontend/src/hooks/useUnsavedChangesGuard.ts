import { useEffect } from 'react'
import { useBlocker } from 'react-router'

// 保存していない変更があるときにページ離脱を警告する（2026-09-09、教材編集画面の要望）。
// アプリ内遷移（サイドバーのリンク、ブラウザの戻る/進むボタン含む）はreact-routerのuseBlockerで
// 検知し、呼び出し元がモーダルを出す（main.tsxでデータルーター化済み、useBlockerが要求する
// コンテキストはそこで用意している）。ブラウザレベルの離脱（リロード・タブを閉じる・URL直接
// 入力）はuseBlockerの対象外のため、window.beforeunloadで別途カバーする（こちらはブラウザ標準の
// 確認ダイアログのみで、カスタムメッセージは表示できない仕様。モダンブラウザの制約）。
export function useUnsavedChangesGuard(shouldBlock: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => shouldBlock && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!shouldBlock) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [shouldBlock])

  return blocker
}
