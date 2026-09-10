import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import Select from '../ui/Select'
import TextInput from '../ui/TextInput'
import { useMaterialAssignments } from '../../hooks/useMaterialAssignments'
import { useProjectMemberships } from '../../hooks/useProjectMemberships'
import { ApiError } from '../../lib/api'
import { updateMaterialAssignments } from '../../lib/assignmentActions'
import { formatDateJst } from '../../lib/datetime'
import type { AssignmentListItem } from '../../types'

// S-06配信設定の編集パネル。元はAssignmentSettings.tsx専用だったが、S-05「公開する」確認モーダル
// （公開前に配信設定を確定させる導線）からも使うため共有コンポーネント化した（2026-09-10）。
export default function AssignmentEditPanel({
  material,
  onClose,
  onSaved,
  className = '',
  defaultChecked = false,
  saveLabel = '保存',
}: {
  material: AssignmentListItem
  onClose: () => void
  onSaved: () => void
  // 呼び出し元のレイアウトに合わせた余白等を渡す（S-06はmt-5でインライン表示、公開確認モーダルは
  // モーダル側の余白に任せるため未指定のまま）。
  className?: string
  // true時、配信行がまだ無い場合の「プロジェクト全体に必修として配信する」の初期状態をONにする
  // （公開確認モーダルからの利用時、公開前で必ずstatus='draft'のため、既存の「公開済みなら初期ON」
  // だけでは常にOFFになってしまうための補い。2026-09-10）。何も選ばずに保存すること自体は
  // 「プロジェクト全体に任意公開する」という正当な選択のため、これはあくまで初期値の既定であって
  // 保存を強制するものではない（同日、ユーザー指摘によりブロックする挙動は廃止した）。
  defaultChecked?: boolean
  // 保存ボタンの文言。公開確認モーダルからの利用時は、この保存が実際には教材の公開も同時に
  // 引き起こす（onSaved経由でdoPublishが呼ばれる）ため、「保存・公開」等それが伝わる文言を
  // 呼び出し元から渡せるようにする（2026-09-10、ユーザー指摘）。S-06単体利用では素の保存のため
  // 既定は「保存」のまま。
  saveLabel?: string
}) {
  const { assignments, isLoading } = useMaterialAssignments(material.id)
  const { memberships } = useProjectMemberships(material.project_id)
  const activeMembers = memberships.filter((m) => m.status === 'active' && m.left_at === null)

  const [projectEnabled, setProjectEnabled] = useState(false)
  const [projectAssignmentId, setProjectAssignmentId] = useState<number | null>(null)
  const [projectDueAt, setProjectDueAt] = useState('')
  // 個人指定は「追加したら必修」固定（2026-09-10、任意個人指定はrequired=falseの行を作るだけで
  // ダッシュボード等どこからも参照されず機能的に意味を持たないため廃止し、必修/任意ラジオを無くした）。
  const [individuals, setIndividuals] = useState<
    { id: number | null; userId: number; name: string; dueAt: string }[]
  >([])
  const [addingUserId, setAddingUserId] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // useMaterialAssignmentsは読み込み中`data?.items ?? []`で毎回新しい配列参照を返すため、
    // isLoadingを見ずに`assignments`だけを依存配列に入れると、読み込み完了までエフェクトが
    // 際限なく再実行されてしまう（2026-09-10、公開確認モーダルへの組み込みで発覚・修正）。
    if (isLoading) return
    // required=falseの行（今回の変更前は「プロジェクト全体・任意」「個人・任意」として保存
    // できていたが、どちらもダッシュボード等どこからも参照されない無効データだったため今回廃止）が
    // 過去に保存されたまま残っている場合、それを読み込んでチェック状態に反映すると、ユーザーが
    // 何も変えるつもりがなくても「保存」を押した瞬間にrequired: trueへ静かに格上げされてしまう
    // （チェックボックスは常にrequired=trueとして送信するため）。これを避けるため、
    // required=falseの行は「そもそも無かった」ものとして扱う（読み込まない＝保存すると削除される。
    // 元々無効なデータなので削除されても実害はない。2026-09-10、レビューで発見・修正）。
    const project = assignments.find((a) => a.scope_type === 'project' && a.required)
    // 公開済みの教材はプロジェクトメンバーであれば元々閲覧・受講できる（F-25の既定アクセス）ため、
    // 配信設定が未設定でも実質的にはプロジェクト全体へ任意公開されているのと同じ状態にある。
    // 初めて編集パネルを開いたとき（＝まだ配信行が無いとき）は、この実態に合わせて既定でチェック
    // 済みにしておく（下書きはそもそも一般メンバーに見えないため対象外。ユーザーフィードバック
    // により2026-09-01追加）。既存の配信行がある場合は常にその実データを優先する。
    // defaultChecked（公開確認モーダルからの利用）時は、公開前で必ずstatus='draft'のため
    // 上記条件だけでは常に未チェックになってしまう。公開ボタンから開いた以上「配信するつもり」が
    // 前提のため、既定でチェック済みにしておく（2026-09-10、ユーザー要望）。
    setProjectEnabled(project ? true : material.status === 'published' || defaultChecked)
    setProjectAssignmentId(project?.id ?? null)
    setProjectDueAt(project?.due_at ? formatDateJst(project.due_at) : '')
    setIndividuals(
      assignments
        .filter((a) => a.scope_type === 'individual' && a.required)
        .map((a) => ({
          id: a.id,
          userId: a.scope_id,
          name: a.scope_label,
          dueAt: a.due_at ? formatDateJst(a.due_at) : '',
        })),
    )
  }, [assignments, isLoading, material.status, defaultChecked])

  const candidateOptions = activeMembers.filter(
    (m) => !individuals.some((i) => i.userId === m.user_id),
  )

  const isCompanyWide = material.is_company_wide

  const addIndividual = () => {
    const userId = Number(addingUserId)
    const member = activeMembers.find((m) => m.user_id === userId)
    if (!member) return
    setIndividuals((prev) => [
      ...prev,
      { id: null, userId, name: member.user_name, dueAt: '' },
    ])
    setAddingUserId('')
  }

  const removeIndividual = (userId: number) => {
    setIndividuals((prev) => prev.filter((i) => i.userId !== userId))
  }

  // 全社Wikiはプロジェクト全体設定を表示・送信しないため、projectEnabledの値によらず
  // 個人指定の人数のみを対象者数として扱う（2026-09-10）。
  const projectScopeActive = projectEnabled && !isCompanyWide
  const targetCount = projectScopeActive ? activeMembers.length : individuals.length

  const handleSave = async () => {
    setSaveError(null)
    setSaving(true)
    try {
      // 全社Wiki教材はプロジェクト全体設定・個人指定とも必修にできない（バックエンドが拒否する）ため、
      // チェックボックス自体を表示しない代わりに、ここでも常に対象から外す（2026-09-10）。
      // 個人指定は、payloadに1件でも含まれていると全社Wikiではバックエンドが保存全体を拒否する
      // （「全社Wikiの教材は個人指定できません」）。過去に作られた個人指定行を1件ずつ「削除」で
      // 消させないと保存自体ができなくなってしまうため、全社Wikiの場合は個人指定を丸ごとpayloadから
      // 除外する（保存すれば自動的に削除される。2026-09-10、レビューで発見・修正）。
      const payload = [
        ...(projectEnabled && !isCompanyWide
          ? [
              {
                id: projectAssignmentId,
                scope_type: 'project' as const,
                scope_id: material.project_id,
                required: true,
                due_at: projectDueAt || null,
              },
            ]
          : []),
        ...(isCompanyWide
          ? []
          : individuals.map((i) => ({
              id: i.id,
              scope_type: 'individual' as const,
              scope_id: i.userId,
              required: true,
              due_at: i.dueAt || null,
            }))),
      ]
      // 「何も選ばない」こと自体が「プロジェクト全体に任意公開する（誰も必修にしない）」という
      // 正当な選択（F-25の既定アクセスにより、配信行が無くても現役プロジェクトメンバーは受講できる
      // ため）であり、エラーで止めるべき状態ではないと判断し、必須バリデーションは廃止した
      // （2026-09-10、ユーザー指摘）。その旨はチェックボックスの下に説明文として表示する。
      await updateMaterialAssignments(material.id, payload)
      onSaved()
      onClose()
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`rounded-md border border-blue-200 border-l-4 border-l-blue-600 shadow-sm ${className}`}>
      <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-4 py-2.5">
        <span className="text-sm font-semibold text-blue-900">配信設定を編集 — {material.title}</span>
      </div>
      <div className="flex flex-col gap-4 p-4">
        {isLoading ? (
          <p className="text-sm text-slate-400">読み込み中...</p>
        ) : (
          <>
            {isCompanyWide ? (
              <p className="text-xs text-slate-400">
                全社Wikiは必修にできないため、この設定はありません（プロジェクトメンバー全員が任意で受講できます）。
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={projectEnabled}
                    onChange={(e) => setProjectEnabled(e.target.checked)}
                  />
                  プロジェクト全体に必修として配信する
                </label>
                <div className="flex items-center gap-2 pl-5">
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                    {material.project_name}
                  </span>
                  <span className="text-xs text-slate-400">この教材が属するプロジェクトです（変更不可）</span>
                </div>
                {!projectEnabled && (
                  <p className="pl-5 text-xs text-slate-400">
                    チェックを外したままの場合、個人を指定しない限り誰も必修にはなりませんが、
                    プロジェクトの現役メンバーは引き続き任意で受講できます（プロジェクト全体への任意公開）。
                  </p>
                )}
                {projectEnabled && (
                  <div className="flex flex-col gap-1 pl-5">
                    <label className="text-xs font-semibold text-slate-500">受講期限</label>
                    <TextInput
                      type="date"
                      value={projectDueAt}
                      onChange={(e) => setProjectDueAt(e.target.value)}
                      className="w-40"
                    />
                  </div>
                )}
              </div>
            )}

            {(!isCompanyWide || individuals.length > 0) && (
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
              <label className="text-xs font-semibold text-slate-500">個人に必修を追加指定</label>
              {isCompanyWide ? (
                <p className="text-xs text-amber-700">
                  全社Wikiは全員が自動的に対象になるため、個人指定には効果がありません。以下は過去に設定された行です（新規追加はできません）。この画面で一度「保存」すると自動的に削除されます。
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  ここで指定したメンバーは必修になります（個別の受講期限も設定できます）。指定していない他のメンバーは任意のままです。選択肢はこのプロジェクトの現役メンバーに限られます。
                </p>
              )}
              {individuals.length > 0 && (
                <div className="flex flex-col gap-2">
                  {individuals.map((i) => (
                    <div key={i.userId} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
                      <span className="min-w-[6rem] text-sm text-slate-800">{i.name}</span>
                      {!isCompanyWide && <span className="text-xs font-semibold text-blue-700">必修</span>}
                      <TextInput
                        type="date"
                        value={i.dueAt}
                        disabled={isCompanyWide}
                        onChange={(e) =>
                          setIndividuals((prev) =>
                            prev.map((x) => (x.userId === i.userId ? { ...x, dueAt: e.target.value } : x)),
                          )
                        }
                        className="w-36"
                      />
                      <button
                        type="button"
                        onClick={() => removeIndividual(i.userId)}
                        className="ml-auto text-xs font-semibold text-red-700 hover:underline"
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!isCompanyWide && (
                <div className="flex items-center gap-2">
                  <Select
                    value={addingUserId}
                    onChange={setAddingUserId}
                    options={[
                      { value: '', label: 'プロジェクトメンバーから選択…' },
                      ...candidateOptions.map((m) => ({ value: String(m.user_id), label: m.user_name })),
                    ]}
                    className="max-w-[280px]"
                  />
                  <Button variant="secondary" disabled={!addingUserId} onClick={addIndividual}>
                    追加
                  </Button>
                </div>
              )}
            </div>
            )}

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <Button className="shrink-0 whitespace-nowrap" onClick={handleSave} disabled={saving}>
                {saving ? `${saveLabel}中…` : saveLabel}
              </Button>
              <Button className="shrink-0 whitespace-nowrap" variant="secondary" onClick={onClose} disabled={saving}>
                キャンセル
              </Button>
              <span className="text-xs text-slate-500 sm:ml-auto">
                対象者プレビュー:{' '}
                <strong className="text-slate-700">
                  {projectScopeActive ? `${material.project_name} 所属 ${targetCount}名` : `${targetCount}名（個人指定のみ）`}
                </strong>
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
