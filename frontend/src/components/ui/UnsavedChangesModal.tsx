// 保存していない変更があるページから離れようとしたときの確認モーダル（2026-09-09）。
// 既存の「本当に削除？」系の確認パターン（MaterialEdit.tsxの章・小見出し削除）と同じ配色・
// 挙動（破棄側=赤い実線ボタン、続行側=枠線のみのボタン）に揃えている。
//
// 2026-09-16、「保存して移動」を追加した。それまでは「編集を続ける」（留まる）／
// 「変更を破棄して移動」（捨てて離れる）の2択のみで、保存してから離れる一番自然な操作が
// 遠回り（一旦キャンセルして保存ボタンを押し、もう一度同じ移動をやり直す）になっていた。
// 「破棄して移動」は、あえて今の変更を残したくない場面（試しに触っただけ・間違えて変更した等）
// で引き続き必要なため、OS標準の保存確認ダイアログ（Save / Don't Save / Cancel相当）と同じ
// 考え方で3択のまま残す。onSaveAndLeaveは省略可（下書き保存の概念がない画面での再利用に備える）。
export default function UnsavedChangesModal({
  onStay,
  onDiscard,
  onSaveAndLeave,
  saving = false,
}: {
  onStay: () => void
  onDiscard: () => void
  onSaveAndLeave?: () => void
  saving?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-base font-bold text-slate-900">保存していない変更があります</h2>
        <p className="mb-5 text-sm text-slate-600">
          このまま移動すると、保存していない変更は破棄されます。編集を続けますか？
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onStay}
            disabled={saving}
            className="rounded-md border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            編集を続ける
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="rounded-md border border-red-300 px-3.5 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            変更を破棄して移動
          </button>
          {onSaveAndLeave && (
            <button
              type="button"
              onClick={onSaveAndLeave}
              disabled={saving}
              className="rounded-md bg-blue-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存して移動'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
