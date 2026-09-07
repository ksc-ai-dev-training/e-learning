import { apiFetch } from './api'

// 新設（F-12）: 連携解除。連携開始（/api/slack/connect）はOAuthリダイレクトのため
// 単なる<a href>で十分（JSからは呼ばない）
export function disconnectSlack(): Promise<void> {
  return apiFetch('/api/slack/disconnect', { method: 'POST' })
}
