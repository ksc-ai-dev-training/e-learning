// 保存していない変更があるページから離れようとしたときの確認モーダル（2026-09-09）。
// 既存の「本当に削除？」系の確認パターン（MaterialEdit.tsxの章・小見出し削除）と同じ配色・
// 挙動（破棄側=赤い実線ボタン、続行側=枠線のみのボタン）に揃えている。
export default function UnsavedChangesModal({
  onStay,
  onDiscard,
}: {
  onStay: () => void
  onDiscard: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-base font-bold text-slate-900">保存していない変更があります</h2>
        <p className="mb-5 text-sm text-slate-600">
          このまま移動すると、保存していない変更は破棄されます。編集を続けますか？
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onStay}
            className="rounded-md border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            編集を続ける
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-md bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            変更を破棄して移動
          </button>
        </div>
      </div>
    </div>
  )
}
