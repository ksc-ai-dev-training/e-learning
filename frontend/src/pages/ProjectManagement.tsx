import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import MyProjectsPanel from '../components/project/MyProjectsPanel'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import TextArea from '../components/ui/TextArea'
import TextInput from '../components/ui/TextInput'
import { useIncomingShares } from '../hooks/useIncomingShares'
import { useMaterials } from '../hooks/useMaterials'
import { useMaterialShares } from '../hooks/useMaterialShares'
import { useMe } from '../hooks/useMe'
import { useMemberCandidates } from '../hooks/useMemberCandidates'
import { useMyMemberships } from '../hooks/useMyMemberships'
import { useProjectDetail } from '../hooks/useProjectDetail'
import { useProjectMemberships } from '../hooks/useProjectMemberships'
import { useProjects } from '../hooks/useProjects'
import { ApiError } from '../lib/api'
import { formatDateJst } from '../lib/datetime'
import { changeMemberRole, deleteProject, inviteMember, removeMember, updateProject } from '../lib/projectActions'
import { createMaterialShare, deleteMaterialShare, respondMaterialShare } from '../lib/shareActions'
import type { MaterialSource, ProjectRole } from '../types'

// 全社Wikiの管理者はシステム管理者のみとし、招待・ロール変更（A-12/A-13）では新たに
// 付与できない（基本設計書5.26節）。バックエンドが400で拒否するため、選択肢自体を出さない。
function roleOptions(isCompanyWide: boolean) {
  return [
    { value: 'learner', label: '受講者' },
    { value: 'editor', label: '編集者' },
    ...(isCompanyWide ? [] : [{ value: 'admin', label: '管理者' }]),
  ]
}

const TABS = [
  { key: 'info', label: 'プロジェクト情報' },
  { key: 'members', label: 'メンバー管理' },
  { key: 'sharing', label: '教材の共有' },
] as const
type TabKey = (typeof TABS)[number]['key']

// S-12 プロジェクト管理（詳細設計書10.12節相当）。プロジェクト情報・メンバー管理・教材の共有
// （F-26、複製モデル）の3タブを実装済み。
//
// 「複数プロジェクトを管理していると常に全社Wikiがデフォルトで開いてしまう」「停止したプロジェクトが
// 管理画面に出てこず復活させられない」「管理画面にもプロジェクト一覧・状態変更がほしい」という
// ユーザーフィードバックを受け（2026-09-01）、:projectIdが無いとき最初の管理対象へ自動遷移していた
// 従来の挙動をやめた。管理者であるプロジェクトが1件しかない場合も含め、常に「自分の全プロジェクト
// 一覧」（S-11と共通のMyProjectsPanel、停止済みも含む全件を表示し、管理者なら状態をその場で変更・
// 再開できる）をまず表示する（1件しかなくても自動で詳細へ進めない方がよいという追加フィードバックを
// 受け、当初の「1件なら自動遷移」という仕様を撤回した）。
export default function ProjectManagement() {
  const { projectId: projectIdParam } = useParams<{ projectId?: string }>()
  const navigate = useNavigate()
  const { me } = useMe()
  const {
    memberships,
    isLoading: membershipsLoading,
    mutate: mutateMemberships,
  } = useMyMemberships(me?.id ?? null)
  const [activeTab, setActiveTab] = useState<TabKey>('info')

  const projectId = projectIdParam ? Number(projectIdParam) : null

  if (membershipsLoading) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  if (projectId === null) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="プロジェクト管理" />
        <div className="px-8 py-6">
          <p className="mb-4 text-[11.5px] text-slate-400">
            自分が参加している全プロジェクト（停止中も含む）を一覧できます。管理者ロールの行のみ、状態の変更と管理画面への遷移ができます。{' '}
            <Link to="/projects/new" className="font-semibold text-blue-700 hover:underline">
              新しいプロジェクトを作成する
            </Link>
          </p>
          <div className="max-w-2xl overflow-hidden rounded-md border border-slate-200">
            <MyProjectsPanel
              memberships={memberships}
              isLoading={false}
              onOpenManage={(id) => navigate(`/projects/${id}/manage`)}
              onStatusChanged={mutateMemberships}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <ProjectManagementBody
      projectId={projectId}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      myUserId={me?.id ?? null}
      onDeleted={mutateMemberships}
    />
  )
}

function ProjectManagementBody({
  projectId,
  activeTab,
  setActiveTab,
  myUserId,
  onDeleted,
}: {
  projectId: number
  activeTab: TabKey
  setActiveTab: (t: TabKey) => void
  myUserId: number | null
  onDeleted: () => void | Promise<unknown>
}) {
  const { project, isLoading: projectLoading, mutate: mutateProject } = useProjectDetail(projectId)
  const {
    memberships,
    isLoading: membershipsLoading,
    mutate: mutateMemberships,
  } = useProjectMemberships(projectId)

  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', description: '', status: 'active' as 'active' | 'completed' })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (project) {
      setForm({ name: project.name, description: project.description ?? '', status: project.status })
      setSaved(false)
    }
  }, [project])

  const handleSave = async () => {
    if (!project) return
    setSaveError(null)
    try {
      await updateProject(project.id, {
        name: form.name,
        description: form.description || null,
        status: form.status,
      })
      await mutateProject()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : '保存に失敗しました')
    }
  }

  const doDelete = async () => {
    if (!project) return
    setDeleteError(null)
    setDeleting(true)
    try {
      await deleteProject(project.id)
      await onDeleted()
      navigate('/projects/manage')
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : '削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  if (projectLoading || !project) {
    return <div className="p-8 text-sm text-slate-400">読み込み中...</div>
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            プロジェクト管理 — {project.name}
            <Badge variant="admin" />
          </span>
        }
        actions={
          <Link to="/projects/manage" className="text-xs font-semibold text-blue-700 hover:underline">
            ← プロジェクト一覧に戻る
          </Link>
        }
      />
      <div className="px-8 py-6">
        <div className="mb-5 flex gap-1 border-b border-slate-200" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 px-3 py-2 text-sm font-semibold ${
                activeTab === tab.key ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'info' && (
          <div className="max-w-xl">
            <div className="flex flex-col gap-4 rounded-md border border-slate-200 p-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500">プロジェクト名</label>
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500">説明</label>
                <TextArea
                  rows={4}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="flex gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-500">状態</label>
                  <Select
                    value={form.status}
                    onChange={(v) => setForm({ ...form, status: v as 'active' | 'completed' })}
                    options={[
                      { value: 'active', label: '進行中' },
                      { value: 'completed', label: '停止' },
                    ]}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-500">作成日</label>
                  <div className="flex h-9 items-center text-sm text-slate-500">
                    {formatDateJst(project.created_at)}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500">作成者</label>
                <div className="text-sm text-slate-700">
                  {project.created_by_name}
                  <span className="ml-2 text-xs text-slate-400">（作成者は自動的に管理者になります）</span>
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button onClick={handleSave}>保存する</Button>
              {saved && <span className="text-sm text-green-700">保存しました</span>}
              {saveError && <span className="text-sm text-red-600">{saveError}</span>}
            </div>

            <div className="mt-6 border-t border-slate-200 pt-4">
              <Button
                variant="danger-ghost"
                onClick={() => setDeleteModalOpen(true)}
                disabled={!project.can_delete}
                title={project.can_delete ? undefined : project.cannot_delete_reason ?? undefined}
              >
                プロジェクトを削除
              </Button>
              {!project.can_delete && (
                <p className="mt-1.5 text-xs text-slate-400">{project.cannot_delete_reason}</p>
              )}
            </div>
          </div>
        )}

        {deleteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-base font-semibold text-slate-800">プロジェクトを削除しますか？</span>
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ×
                </button>
              </div>
              <p className="mb-3 text-sm leading-relaxed text-slate-600">
                「{project.name}」を完全に削除します。含まれる下書き教材があればすべて一緒に削除され、<strong>元に戻せません</strong>。
              </p>
              {deleteError && <p className="mb-3 text-sm text-red-600">{deleteError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
                  キャンセル
                </Button>
                <Button variant="danger-ghost" onClick={doDelete} disabled={deleting}>
                  {deleting ? '削除中...' : '削除する'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'members' && (
          <MembersTab
            projectId={projectId}
            isCompanyWide={project.is_company_wide}
            memberships={memberships}
            membershipsLoading={membershipsLoading}
            mutateMemberships={mutateMemberships}
            myUserId={myUserId}
          />
        )}

        {activeTab === 'sharing' && <SharingTab projectId={projectId} />}
      </div>
    </div>
  )
}

function MembersTab({
  projectId,
  isCompanyWide,
  memberships,
  membershipsLoading,
  mutateMemberships,
  myUserId,
}: {
  projectId: number
  isCompanyWide: boolean
  memberships: ReturnType<typeof useProjectMemberships>['memberships']
  membershipsLoading: boolean
  mutateMemberships: () => void | Promise<unknown>
  myUserId: number | null
}) {
  const [pendingRemove, setPendingRemove] = useState<number | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [inviteQuery, setInviteQuery] = useState('')
  const [inviteRole, setInviteRole] = useState<ProjectRole>('learner')
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null)
  const { candidates } = useMemberCandidates(projectId, inviteQuery)

  const handleRoleChange = async (userId: number, role: ProjectRole) => {
    setRowError(null)
    try {
      await changeMemberRole(projectId, userId, role)
      await mutateMemberships()
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : 'ロールの変更に失敗しました')
    }
  }

  const handleRemove = async (userId: number) => {
    setRowError(null)
    try {
      await removeMember(projectId, userId)
      await mutateMemberships()
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : '削除に失敗しました')
    } finally {
      setPendingRemove(null)
    }
  }

  const handleInvite = async () => {
    if (selectedCandidateId === null) return
    setRowError(null)
    try {
      await inviteMember(projectId, selectedCandidateId, inviteRole)
      await mutateMemberships()
      setSelectedCandidateId(null)
      setInviteQuery('')
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : '招待に失敗しました')
    }
  }

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        メンバーの招待・削除、ロール（管理者/編集者/受講者）の設定は、このプロジェクトの管理者が行います。
        追加は招待制です。招待した時点ではまだ権限は発生せず、招待された本人が承諾して初めてメンバーとして有効になります。
      </p>

      {rowError && <p className="mb-3 text-sm text-red-600">{rowError}</p>}

      {membershipsLoading ? (
        <p className="text-sm text-slate-400">読み込み中...</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-normal">氏名</th>
                <th className="px-3 py-2 font-normal">全社ロール</th>
                <th className="px-3 py-2 font-normal">プロジェクトロール</th>
                <th className="px-3 py-2 font-normal">状態</th>
                <th className="px-3 py-2 font-normal">参加日</th>
                <th className="px-3 py-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {memberships
                .filter((m) => m.left_at === null)
                .map((m) => {
                  const isSelf = m.user_id === myUserId
                  return (
                    <tr key={m.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 text-slate-800">
                        {m.user_name}
                        {isSelf && <span className="ml-1 text-xs text-slate-400">（あなた）</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={m.global_role === 'admin' ? 'admin' : 'learner'} />
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={m.role}
                          disabled={isSelf || m.status !== 'active'}
                          onChange={(v) => handleRoleChange(m.user_id, v as ProjectRole)}
                          options={roleOptions(isCompanyWide && m.role !== 'admin')}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={m.status === 'active' ? 'member-active' : m.status === 'invited' ? 'member-invited' : 'member-declined'} />
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {m.joined_at ? formatDateJst(m.joined_at) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {isSelf ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : pendingRemove === m.user_id ? (
                          <span className="flex items-center gap-1 text-xs">
                            本当に削除？
                            <button
                              type="button"
                              onClick={() => handleRemove(m.user_id)}
                              className="rounded bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700"
                            >
                              削除する
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingRemove(null)}
                              className="rounded border border-slate-300 px-2 py-1 text-slate-500 hover:bg-slate-100"
                            >
                              キャンセル
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPendingRemove(m.user_id)}
                            className="text-xs font-semibold text-red-700 hover:underline"
                          >
                            {m.status === 'invited' ? '招待を取消' : '削除'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">社員を選択して招待</label>
          <TextInput
            placeholder="氏名・メールアドレスで検索"
            value={inviteQuery}
            onChange={(e) => {
              setInviteQuery(e.target.value)
              setSelectedCandidateId(null)
            }}
            className="w-64"
          />
        </div>
        {inviteQuery && candidates.length > 0 && (
          <Select
            value={selectedCandidateId !== null ? String(selectedCandidateId) : ''}
            onChange={(v) => setSelectedCandidateId(Number(v))}
            options={[
              { value: '', label: '候補から選択...' },
              ...candidates.map((c) => ({ value: String(c.id), label: `${c.name}（${c.email}）` })),
            ]}
          />
        )}
        <Select
          value={inviteRole}
          onChange={(v) => setInviteRole(v as ProjectRole)}
          options={roleOptions(isCompanyWide)}
        />
        <Button variant="secondary" disabled={selectedCandidateId === null} onClick={handleInvite}>
          招待する
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        招待した時点ではまだ権限は発生しません。招待された本人が承諾して初めて、実際にメンバーとして教材の受講・編集ができるようになります。
      </p>
    </div>
  )
}

// S-12 教材の共有タブ（F-26、複製モデル。基本設計書5.27節）。「このプロジェクトから申請した共有」
// （申請側、A-59/A-60/A-61）と「他プロジェクトからの共有リクエスト」（承認側、A-66/A-65）の
// 2セクションで構成する（画面モックアップと同じ構成）。
function SharingTab({ projectId }: { projectId: number }) {
  return (
    <div className="flex flex-col gap-8">
      <OutgoingSharesSection projectId={projectId} />
      <IncomingSharesSection projectId={projectId} />
    </div>
  )
}

function OutgoingSharesSection({ projectId }: { projectId: number }) {
  // includeArchived=trueで取得する。バックエンド（A-60）はアーカイブ済み教材の共有申請を拒否しない
  // にもかかわらず、既定のuseMaterials(projectId)はアーカイブ済みを除外するため、この一覧に
  // 一切出てこず実質共有できないという不一致があった（2026-09-02、再監査で発見・修正）。
  const { materials, isLoading } = useMaterials(projectId, true)

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">このプロジェクトから申請した共有</h3>
      <p className="mb-3 text-xs text-slate-500">
        申請しただけでは何も起きません。共有先プロジェクトの管理者が承認すると、その時点の教材内容（目次・全ページ・問題・添付ファイル）で複製が共有先プロジェクトに新規作成されます。複製後は共有先プロジェクトの独立した教材として、内容編集・配信設定・公開状態はすべて共有先プロジェクトの管理者・編集者が管理します（元教材を更新しても複製には反映されません）。下書きの教材は共有申請できません。
      </p>
      {isLoading ? (
        <p className="text-sm text-slate-400">読み込み中...</p>
      ) : materials.length === 0 ? (
        <p className="text-sm text-slate-400">教材がありません。</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-normal">教材名</th>
                <th className="px-3 py-2 font-normal">状態</th>
                <th className="px-3 py-2 font-normal">共有先プロジェクト</th>
                <th className="px-3 py-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <OutgoingShareRow key={m.id} projectId={projectId} material={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function OutgoingShareRow({ projectId, material }: { projectId: number; material: MaterialSource }) {
  const { shares, mutate } = useMaterialShares(material.id)
  const { projects } = useProjects('learner')
  const [adding, setAdding] = useState(false)
  const [targetProjectId, setTargetProjectId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 却下(rejected)は再申請可能なため候補から除外しない。承認待ち・承認済みの共有先のみ除外する
  const activeShares = shares.filter((s) => s.status !== 'rejected')
  const candidateProjects = projects.filter(
    (p) => p.id !== projectId && !activeShares.some((s) => s.shared_to_project_id === p.id),
  )

  const handleAdd = async () => {
    if (targetProjectId === null) return
    setError(null)
    try {
      await createMaterialShare(material.id, targetProjectId)
      await mutate()
      setTargetProjectId(null)
      setAdding(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '申請に失敗しました')
    }
  }

  const handleWithdraw = async (shareId: number) => {
    setError(null)
    try {
      await deleteMaterialShare(material.id, shareId)
      await mutate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '取り下げに失敗しました')
    }
  }

  return (
    <tr className="border-b border-slate-50 align-top last:border-0">
      <td className="px-3 py-2 text-slate-800">{material.title}</td>
      <td className="px-3 py-2">
        {/* is_archivedはstatusとは独立したフラグ（statusは'draft'/'published'の2値のみ）のため、
            アーカイブ済みかどうかはis_archivedで判定する（archivedを含める前はstatusのみで
            分岐しており、アーカイブ済み教材も常に「公開中」表示になっていた不具合を含んでいた） */}
        <Badge variant={material.is_archived ? 'archived' : material.status === 'published' ? 'published' : 'draft'} />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {activeShares.length === 0 && <span className="text-xs text-slate-300">—</span>}
          {activeShares.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600"
            >
              {s.shared_to_project_name}
              <Badge variant={s.status === 'pending' ? 'share-pending' : 'share-accepted'} />
              {s.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => handleWithdraw(s.id)}
                  className="text-slate-400 hover:text-red-600"
                  title="申請を取り下げる"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-2">
        {material.status === 'draft' ? (
          <span className="text-xs text-slate-300" title="下書きのため共有申請できません">
            共有を申請
          </span>
        ) : adding ? (
          <div className="flex flex-col gap-1.5">
            <Select
              value={targetProjectId !== null ? String(targetProjectId) : ''}
              onChange={(v) => setTargetProjectId(v ? Number(v) : null)}
              options={[
                { value: '', label: '共有先プロジェクトを選択...' },
                ...candidateProjects.map((p) => ({ value: String(p.id), label: p.name })),
              ]}
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleAdd} disabled={targetProjectId === null}>
                申請を送る
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setAdding(false)
                  setTargetProjectId(null)
                  setError(null)
                }}
              >
                キャンセル
              </Button>
            </div>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-blue-700 hover:underline">
            共有を申請
          </button>
        )}
      </td>
    </tr>
  )
}

function IncomingSharesSection({ projectId }: { projectId: number }) {
  const { incomingShares, isLoading, mutate } = useIncomingShares(projectId)
  const [rowError, setRowError] = useState<string | null>(null)
  const [respondingId, setRespondingId] = useState<number | null>(null)

  const handleRespond = async (materialId: number, shareId: number, status: 'accepted' | 'rejected') => {
    setRowError(null)
    setRespondingId(shareId)
    try {
      await respondMaterialShare(materialId, shareId, status)
      await mutate()
    } catch (e) {
      setRowError(e instanceof ApiError ? e.message : '処理に失敗しました')
    } finally {
      setRespondingId(null)
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">他プロジェクトからの共有リクエスト（このプロジェクト宛て）</h3>
      <p className="mb-3 text-xs text-slate-500">
        承認すると、その時点の教材内容（目次・全ページ・問題・添付ファイル）でこのプロジェクトに複製が新規作成されます。却下すると何も作成されません。承認後は複製が独立した教材になるため専用の「共有解除」操作はなく、不要になった場合は複製先の教材を通常どおりアーカイブ・削除してください。
      </p>
      {rowError && <p className="mb-3 text-sm text-red-600">{rowError}</p>}
      {isLoading ? (
        <p className="text-sm text-slate-400">読み込み中...</p>
      ) : incomingShares.length === 0 ? (
        <p className="text-sm text-slate-400">承認待ちの共有リクエストはありません。</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-normal">教材名</th>
                <th className="px-3 py-2 font-normal">共有元プロジェクト</th>
                <th className="px-3 py-2 font-normal">申請日</th>
                <th className="px-3 py-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {incomingShares.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 text-slate-800">{s.material_title}</td>
                  <td className="px-3 py-2 text-slate-500">{s.shared_by_project_name}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDateJst(s.shared_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={respondingId === s.id}
                        onClick={() => handleRespond(s.material_id, s.id, 'accepted')}
                        className="rounded bg-blue-700 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                      >
                        承認
                      </button>
                      <button
                        type="button"
                        disabled={respondingId === s.id}
                        onClick={() => handleRespond(s.material_id, s.id, 'rejected')}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        却下
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
