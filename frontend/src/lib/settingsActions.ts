import { apiFetch } from './api'
import type { SystemSettings } from '../types'

// A-56: システム設定の部分更新（S-10 管理：システム設定タブ）
export function updateSettings(body: Partial<SystemSettings>): Promise<SystemSettings> {
  return apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(body) })
}

// A-57: Slack Webhookへのテスト送信
export function sendSlackTest(): Promise<{ detail: string }> {
  return apiFetch('/api/settings/slack-test', { method: 'POST' })
}

// A-80: システム設定を初期状態に戻す
export function resetSettings(): Promise<void> {
  return apiFetch('/api/settings', { method: 'DELETE' })
}
