// 画面(ビューポート)の上部に固定表示する通知（2026-09-09）。教材編集画面で「保存しました」が
// 編集画面の途中の決まった位置に表示され、下の方までスクロールしていると見えなかったための修正。
// position: fixedはスクロールコンテナ（AppShellのoverflow-y-auto）ではなくビューポート基準で
// 位置決めされるため、スクロール位置に関わらず常に見える。
export default function Toast({ message, tone = 'success' }: { message: string; tone?: 'success' | 'error' }) {
  const toneClass =
    tone === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
  return (
    <div
      role="status"
      className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-md ${toneClass}`}
    >
      {message}
    </div>
  )
}
