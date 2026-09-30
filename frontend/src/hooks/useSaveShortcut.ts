import { useEffect } from 'react'

// Ctrl+S（Mac: Cmd+S）で保存を実行できるようにする（2026-09-09、教材作成時に毎回保存ボタンを
// クリックする必要があり負担というフィードバックを受け追加）。ブラウザ既定の「ページを保存」
// ダイアログを止めるためpreventDefaultが必須。enabled=falseの間（保存中など）は何もしない。
export function useSaveShortcut(onSave: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      onSave()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSave, enabled])
}
