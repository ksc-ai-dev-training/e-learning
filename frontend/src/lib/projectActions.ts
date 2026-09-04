import { apiFetch } from './api'
import type { ProjectDetail, ProjectMembership, ProjectRole } from '../types'

// A-09: プロジェクト作成。作成者は自動的にそのプロジェクトの管理者になる
export function createProject(body: { name: string; description: string | null }): Promise<ProjectDetail> {
  return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(body) })
}

// A-10: プロジェクト情報（名称・説明・状態）更新
export function updateProject(
  projectId: number,
  body: { name: string; description: string | null; status: 'active' | 'completed' },
): Promise<ProjectDetail> {
  return apiFetch(`/api/projects/${projectId}`, { method: 'PUT', body: JSON.stringify(body) })
}

// A-93: プロジェクトの完全削除
export function deleteProject(projectId: number): Promise<void> {
  return apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' })
}

// A-92: プロジェクトの状態のみを変更する（一覧からのワンクリック切り替え・再開用）
export function changeProjectStatus(
  projectId: number,
  status: 'active' | 'completed',
): Promise<{ id: number; status: string }> {
  return apiFetch(`/api/projects/${projectId}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
}

// A-12: メンバーを招待する（status='invited'で作成）
export function inviteMember(
  projectId: number,
  userId: number,
  role: ProjectRole,
): Promise<ProjectMembership> {
  return apiFetch(`/api/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, role }),
  })
}

// A-13: メンバーのロール変更
export function changeMemberRole(
  projectId: number,
  userId: number,
  role: ProjectRole,
): Promise<ProjectMembership> {
  return apiFetch(`/api/projects/${projectId}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
}

// A-13: メンバーをプロジェクトから削除（論理削除）
export function removeMember(projectId: number, userId: number): Promise<ProjectMembership> {
  return apiFetch(`/api/projects/${projectId}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ action: 'remove' }),
  })
}
