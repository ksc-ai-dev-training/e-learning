import { apiFetch } from './api'
import type { CliTokenItem } from '../types'

// 新規: ログイン中のWebセッションからCLIトークン（Claude Code連携・MCPサーバ共通の鍵）を自己発行する
export function issueCliKey(): Promise<{ token: string; manabi_url: string }> {
  return apiFetch('/api/auth/cli/token', { method: 'POST' })
}

// 新規: 初回ログイン時の案内画面で「後で設定する」を選んだ場合に呼ぶ（鍵は発行しない）
export function dismissCliKeyPrompt(): Promise<{ detail: string }> {
  return apiFetch('/api/auth/cli/prompt-dismiss', { method: 'POST' })
}

// 新規: 自分が発行した鍵の一覧（プロフィール画面の鍵管理パネル用）
export function listCliKeys(): Promise<{ items: CliTokenItem[] }> {
  return apiFetch('/api/auth/cli/tokens')
}

// 新規: 発行済みの鍵を、鍵自体を提示せずID指定で個別に失効させる
export function revokeCliKey(id: number): Promise<{ detail: string }> {
  return apiFetch(`/api/auth/cli/tokens/${id}`, { method: 'DELETE' })
}
