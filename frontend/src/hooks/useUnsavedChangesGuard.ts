import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router'

// 保存していない変更があるときにページ離脱を警告する（2026-09-09、教材編集画面の要望）。
// アプリ内遷移（サイドバーのリンク、ブラウザの戻る/進むボタン含む）はreact-routerのuseBlockerで
// 検知し、呼び出し元がモーダルを出す（main.tsxでデータルーター化済み、useBlockerが要求する
// コンテキストはそこで用意している）。ブラウザレベルの離脱（リロード・タブを閉じる・URL直接
// 入力）はuseBlockerの対象外のため、window.beforeunloadで別途カバーする（こちらはブラウザ標準の
// 確認ダイアログのみで、カスタムメッセージは表示できない仕様。モダンブラウザの制約）。
export function useUnsavedChangesGuard(shouldBlock: boolean) {
  // useBlockerに渡す判定関数はレンダーごとに新しく作られ、react-router側への再登録は
  // useEffect経由（＝コミット後）になる。そのため「setDirty(false)した直後、同じ関数内で
  // 同期的にnavigate()を呼ぶ」ようなコードでは、まだ古い（shouldBlock=trueの）判定関数のまま
  // navigate()が評価されてしまい、保存直後の自分自身の遷移が誤ってブロックされる
  // （2026-09-09、保存直後に「変更を破棄しますか」が誤表示される不具合により発見）。
  // refはレンダーを待たず同期的に読み書きできるため、判定関数の内部でこちらを参照することで
  // 回避する。
  const shouldBlockRef = useRef(shouldBlock)
  shouldBlockRef.current = shouldBlock

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      shouldBlockRef.current && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!shouldBlock) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [shouldBlock])

  // 保存成功時など、呼び出し元がこれから行う自分自身のnavigate()をブロックさせたくない場合に、
  // navigate()の直前で呼ぶ。setDirty(false)等のReact stateの更新を待たず、同期的に判定を
  // 無効化する。
  const bypassOnce = () => {
    shouldBlockRef.current = false
  }

  return { ...blocker, bypassOnce }
}
