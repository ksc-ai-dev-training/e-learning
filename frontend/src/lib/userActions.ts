import { apiFetch } from './api'
import type { AdminUser, Role } from '../types'

// A-54: ロール変更・有効/無効切替（S-10 管理：ユーザー管理タブ）
export function updateUser(
  userId: number,
  body: { role?: Role; is_active?: boolean },
): Promise<AdminUser> {
  return apiFetch(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify(body) })
}
