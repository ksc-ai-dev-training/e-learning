import { useEffect, useState } from 'react'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Panel from '../components/ui/Panel'
import TextInput from '../components/ui/TextInput'
import { useMe } from '../hooks/useMe'
import { useMyMemberships } from '../hooks/useMyMemberships'
import { ApiError } from '../lib/api'
import { respondToInvite } from '../lib/projectActions'
import { resetProfileIcon, updateProfileName, uploadProfileIcon } from '../lib/profileActions'

// S-15 プロフィール編集（基本設計書4.14a節）。表示名編集・アイコンのアップロード／Googleの
// プロフィール画像への差し戻し・所属プロジェクト一覧・招待されているプロジェクトへの承諾/辞退を
// 扱う（A-75〜A-77, A-67）。Slack連携（F-12）はプロジェクト単位のWebhook通知に置き換えたため、
// 本人ごとの連携UIは持たない（2026-09-04）。
export default function ProfileEdit() {
  const { me, mutate: mutateMe } = useMe()
  const { memberships, isLoading: membershipsLoading, mutate: mutateMemberships } = useMyMemberships(
    me?.id ?? null,
  )

  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameSavedMessage, setNameSavedMessage] = useState<string | null>(null)

  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [iconError, setIconError] = useState<string | null>(null)

  const [respondingId, setRespondingId] = useState<number | null>(null)
  const [respondError, setRespondError] = useState<string | null>(null)

  useEffect(() => {
    if (me) setName(me.name)
  }, [me])

  if (!me) return null

  const activeProjects = memberships.filter((m) => m.status === 'active' && m.left_at === null)
  const invitations = memberships.filter((m) => m.status === 'invited')

  const handleSaveName = async () => {
    setNameError(null)
    setNameSavedMessage(null)
    if (name.trim().length === 0) {
      setNameError('表示名を入力してください')
      return
    }
    setSavingName(true)
    try {
      await updateProfileName(name.trim())
      await mutateMe()
      setNameSavedMessage('保存しました')
    } catch (e) {
      setNameError(e instanceof ApiError ? e.message : '保存に失敗しました')
    } finally {
      setSavingName(false)
    }
  }

  const handleIconSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setIconError(null)
    setUploadingIcon(true)
    try {
      await uploadProfileIcon(file)
      await mutateMe()
    } catch (err) {
      setIconError(err instanceof ApiError ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploadingIcon(false)
    }
  }

  const handleResetIcon = async () => {
    setIconError(null)
    setUploadingIcon(true)
    try {
      await resetProfileIcon()
      await mutateMe()
    } catch (err) {
      setIconError(err instanceof ApiError ? err.message : '削除に失敗しました')
    } finally {
      setUploadingIcon(false)
    }
  }

  const handleRespond = async (membershipId: number, status: 'active' | 'declined') => {
    setRespondError(null)
    setRespondingId(membershipId)
    try {
      await respondToInvite(membershipId, status)
      await mutateMemberships()
    } catch (err) {
      setRespondError(err instanceof ApiError ? err.message : '応答に失敗しました')
    } finally {
      setRespondingId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="プロフィール編集" />
      <div className="max-w-2xl px-8 py-6">
        <Panel title="アカウント情報">
          <div className="flex flex-col gap-4 p-4 text-sm">
            <div className="flex items-center gap-4">
              {me.picture_url ? (
                <img src={me.picture_url} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xl font-semibold text-blue-900">
                  {me.name.slice(0, 1)}
                </span>
              )}
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <label className="flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    {uploadingIcon ? '処理中...' : '画像を変更'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={handleIconSelect}
                      disabled={uploadingIcon}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleResetIcon}
                    disabled={uploadingIcon}
                    className="text-xs font-semibold text-slate-500 hover:text-red-700 hover:underline disabled:opacity-50"
                  >
                    Googleの画像に戻す
                  </button>
                </div>
                <span className="text-[11px] text-slate-400">PNG・JPEG、2MBまで</span>
                {iconError && <span className="text-xs text-red-600">{iconError}</span>}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-20 flex-shrink-0 text-xs font-semibold text-slate-500">表示名</span>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
              <Button variant="secondary" onClick={handleSaveName} disabled={savingName}>
                {savingName ? '保存中...' : '保存'}
              </Button>
              {nameSavedMessage && <span className="text-xs text-green-700">{nameSavedMessage}</span>}
            </div>
            {nameError && <p className="text-xs text-red-600">{nameError}</p>}

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

        <Panel title="所属プロジェクト" count={`${activeProjects.length}件`}>
          {membershipsLoading ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">読み込み中...</p>
          ) : activeProjects.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">所属しているプロジェクトはありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activeProjects.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-800">{m.project_name}</span>
                  <span className="text-xs text-slate-500">
                    {m.role === 'admin' ? '管理者' : m.role === 'editor' ? '編集者' : '受講者'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {invitations.length > 0 && (
          <Panel title="招待されているプロジェクト" count={`${invitations.length}件`}>
            {respondError && <p className="px-4 pt-3 text-sm text-red-600">{respondError}</p>}
            <ul className="divide-y divide-slate-100">
              {invitations.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="text-slate-800">{m.project_name}</span>
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={respondingId === m.id}
                      onClick={() => handleRespond(m.id, 'active')}
                      className="text-xs font-semibold text-blue-700 hover:underline disabled:opacity-50"
                    >
                      承諾
                    </button>
                    <button
                      type="button"
                      disabled={respondingId === m.id}
                      onClick={() => handleRespond(m.id, 'declined')}
                      className="text-xs font-semibold text-slate-500 hover:text-red-700 hover:underline disabled:opacity-50"
                    >
                      辞退
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  )
}
