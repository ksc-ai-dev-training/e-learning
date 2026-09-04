import { useState } from 'react'
import Badge from '../ui/Badge'
import Select from '../ui/Select'
import { ApiError } from '../../lib/api'
import { changeProjectStatus } from '../../lib/projectActions'
import type { ProjectMembership } from '../../types'

// 「自分の全プロジェクト一覧」共通パネル（S-11下部・S-12の一覧表示で共用、詳細設計書10.10/10.11節）。
// プロジェクト名・自分のロール・プロジェクトの状態（進行中/停止）を表示する。管理者ロールで参加中の
// 行のみ、状態をその場で変更（A-92。停止済みプロジェクトの再開もここから行う）でき、管理画面へ
// 進める。ユーザーからの「複数プロジェクトを持っていると管理画面が常に全社Wikiで開く」「停止した
// プロジェクトが管理画面に出てこず復活させられない」「管理画面にも一覧・状態変更がほしい」という
// フィードバックを受け、S-12（作成画面にしかなかった）と同じ一覧をS-12にも持たせる形で新設した
// （2026-09-01）。停止中の行は進行中と色を分け（行を淡色化）、既定では進行中のプロジェクトのみを
// 表示し、「停止中のプロジェクトも表示する」チェックで停止中も含めた全件表示に切り替えられる
// （同日、追加フィードバックにより新設）。
export default function MyProjectsPanel({
  memberships,
  isLoading,
  onOpenManage,
  onStatusChanged,
}: {
  memberships: ProjectMembership[]
  isLoading: boolean
  onOpenManage: (projectId: number) => void
  onStatusChanged: () => void | Promise<unknown>
}) {
  const [statusUpdating, setStatusUpdating] = useState<number | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [showStopped, setShowStopped] = useState(false)

  const allRows = memberships.filter((m) => m.left_at === null)
  const rows = showStopped ? allRows : allRows.filter((m) => m.project_status === 'active')
  const stoppedCount = allRows.filter((m) => m.project_status === 'completed').length

  const handleStatusChange = async (projectId: number, status: 'active' | 'completed') => {
    setStatusError(null)
    setStatusUpdating(projectId)
    try {
      await changeProjectStatus(projectId, status)
      await onStatusChanged()
    } catch (e) {
      setStatusError(e instanceof ApiError ? e.message : '状態の変更に失敗しました')
    } finally {
      setStatusUpdating(null)
    }
  }

  if (isLoading) {
    return <p className="px-4 py-6 text-center text-sm text-slate-400">読み込み中...</p>
  }

  if (allRows.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-slate-400">参加しているプロジェクトがありません。</p>
  }

  return (
    <div>
      {stoppedCount > 0 && (
        <div className="flex items-center justify-end border-b border-slate-100 px-4 py-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showStopped}
              onChange={(e) => setShowStopped(e.target.checked)}
            />
            停止中のプロジェクトも表示する（{stoppedCount}件）
          </label>
        </div>
      )}
      {statusError && <p className="mb-2 px-4 pt-2 text-sm text-red-600">{statusError}</p>}
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">
          表示するプロジェクトがありません（進行中のプロジェクトはありません。停止中のみ表示できます）。
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-normal">プロジェクト名</th>
              <th className="px-4 py-2 font-normal">あなたのロール</th>
              <th className="px-4 py-2 font-normal">状態</th>
              <th className="px-4 py-2 font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const canManage = m.role === 'admin' && m.status === 'active'
              const stopped = m.project_status === 'completed'
              return (
                <tr
                  key={m.id}
                  className={`border-b border-slate-50 last:border-0 ${stopped ? 'bg-slate-50' : ''}`}
                >
                  <td className={`px-4 py-2 ${stopped ? 'text-slate-400' : 'text-slate-800'}`}>{m.project_name}</td>
                  <td className={`px-4 py-2 ${stopped ? 'text-slate-400' : 'text-slate-600'}`}>
                    {m.role === 'admin' ? '管理者' : m.role === 'editor' ? '編集者' : '受講者'}
                    {m.status === 'invited' && <span className="ml-1 text-xs text-amber-600">（招待中）</span>}
                  </td>
                  <td className="px-4 py-2">
                    {canManage ? (
                      <div className="flex items-center gap-2">
                        <Select
                          value={m.project_status}
                          disabled={statusUpdating === m.project_id}
                          onChange={(v) => handleStatusChange(m.project_id, v as 'active' | 'completed')}
                          options={[
                            { value: 'active', label: '進行中' },
                            { value: 'completed', label: '停止' },
                          ]}
                        />
                        <Badge variant={stopped ? 'project-stopped' : 'project-active'} />
                      </div>
                    ) : (
                      <Badge variant={stopped ? 'project-stopped' : 'project-active'} />
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => onOpenManage(m.project_id)}
                        className="text-xs font-semibold text-blue-700 hover:underline"
                      >
                        管理する
                      </button>
                    ) : (
                      <span className="text-xs text-slate-300" title="管理者ではないため管理画面は開けません">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
