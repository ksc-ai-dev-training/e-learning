import { useState } from 'react'
import { useNavigate } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import MyProjectsPanel from '../components/project/MyProjectsPanel'
import Button from '../components/ui/Button'
import TextArea from '../components/ui/TextArea'
import TextInput from '../components/ui/TextInput'
import { useMe } from '../hooks/useMe'
import { useMyMemberships } from '../hooks/useMyMemberships'
import { ApiError } from '../lib/api'
import { createProject } from '../lib/projectActions'

// S-11 プロジェクト作成（詳細設計書10.10節相当）。誰でも作成でき、作成者は自動的にそのプロジェクトの
// 管理者になる。作成後はS-12（プロジェクト管理）へ遷移する。「作成する」押下は即APIを呼ばず、内容
// 確認モーダルを一段挟む（押し間違いでの誤作成を防ぐ、ユーザーフィードバックにより2026-09-01追加）。
export default function ProjectCreate() {
  const navigate = useNavigate()
  const { me } = useMe()
  const { memberships, isLoading: membershipsLoading, mutate: mutateMemberships } = useMyMemberships(me?.id ?? null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    setError(null)
    setSubmitting(true)
    try {
      const project = await createProject({ name, description: description || null })
      navigate(`/projects/${project.id}/manage`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '作成に失敗しました')
      setConfirming(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    setName('')
    setDescription('')
    setError(null)
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="プロジェクト作成" />
      <div className="px-8 py-6">
        <p className="mb-4 text-[11.5px] text-slate-400">
          この画面は全員がアクセスできます。システム全体のロール（member/admin）に関わらず、誰でもプロジェクトを新規作成できます。
        </p>

        <div className="max-w-xl">
          <div className="flex flex-col gap-4 rounded-md border border-slate-200 p-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">プロジェクト名</label>
              <TextInput
                placeholder="例: 経費精算システム刷新"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500">説明</label>
              <TextArea
                rows={4}
                placeholder="プロジェクトの目的や概要を入力してください（後からいつでも編集できます）"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>

          <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900">
            <strong>作成すると何が起きるか:</strong>{' '}
            あなたは自動的にこのプロジェクトの管理者になります。プロジェクトの管理者は、プロジェクト情報の編集、メンバーの追加・削除・ロール（管理者/編集者/受講者）の設定ができます。
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-3 flex gap-2">
            <Button onClick={() => setConfirming(true)} disabled={submitting || name.trim().length === 0}>
              作成する
            </Button>
            <Button variant="secondary" onClick={handleCancel} disabled={submitting}>
              キャンセル
            </Button>
          </div>
        </div>

        <section className="mt-8 max-w-xl rounded-md border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-700">自分が参加しているプロジェクト</span>
            <span className="text-xs text-slate-400">{memberships.filter((m) => m.left_at === null).length}件</span>
          </div>
          <MyProjectsPanel
            memberships={memberships}
            isLoading={membershipsLoading}
            onOpenManage={(projectId) => navigate(`/projects/${projectId}/manage`)}
            onStatusChanged={mutateMemberships}
          />
        </section>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-3 text-base font-bold text-slate-900">この内容でプロジェクトを作成しますか？</h2>
            <dl className="mb-4 flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-xs font-semibold text-slate-500">プロジェクト名</dt>
                <dd className="text-slate-800">{name}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">説明</dt>
                <dd className="whitespace-pre-wrap text-slate-800">{description || '（未入力）'}</dd>
              </div>
            </dl>
            <p className="mb-4 text-xs text-slate-500">
              作成すると、あなたは自動的にこのプロジェクトの管理者になります。
            </p>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={submitting}>
                戻る
              </Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? '作成中…' : '作成する'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
