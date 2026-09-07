import { apiFetch } from './api'
import type { MemberAttemptItem, MemberOverdueRequired, ProjectDetail, ProjectMembership, ProjectRole } from '../types'

// A-09: プロジェクト作成。作成者は自動的にそのプロジェクトの管理者になる
export function createProject(body: { name: string; description: string | null }): Promise<ProjectDetail> {
  return apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(body) })
}

// A-10: プロジェクト情報（名称・説明・状態・Slack Webhook URL）更新
export function updateProject(
  projectId: number,
  body: {
    name: string
    description: string | null
    status: 'active' | 'completed'
    slack_webhook_url: string | null
  },
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

// 新設: S-12「メンバー管理」タブの受験状況パネル（REQ-F-09）。このプロジェクトのadmin、
// またはシステムadminのみ取得できる
export function getMemberAttemptStatus(
  projectId: number,
  userId: number,
): Promise<{ items: MemberAttemptItem[] }> {
  return apiFetch(`/api/projects/${projectId}/members/${userId}/attempts`)
}

// 新設: 再受験回数の上限リセット（学習記録自体は削除しない）
export function resetAttemptLimit(
  projectId: number,
  userId: number,
  materialId: number,
  scopeNodeId: number | null,
): Promise<void> {
  return apiFetch(`/api/projects/${projectId}/members/${userId}/attempts/reset`, {
    method: 'POST',
    body: JSON.stringify({ material_id: materialId, scope_node_id: scopeNodeId }),
  })
}

// 新設（F-11）: S-12「メンバー管理」タブの未受講の必修教材パネル
export function getMemberOverdueRequired(
  projectId: number,
  userId: number,
): Promise<MemberOverdueRequired> {
  return apiFetch(`/api/projects/${projectId}/members/${userId}/overdue-required`)
}

// 新設（F-12）: プロジェクトの必修教材の未受講状況（教材単位の集計）を、登録済みのSlack
// Webhook URL宛てに送る（個人ごとの催促は運用でカバーする方針、2026-09-04）
export function sendProjectSlackReminder(projectId: number): Promise<{ detail: string }> {
  return apiFetch(`/api/projects/${projectId}/slack-remind`, { method: 'POST' })
}
