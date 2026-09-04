import { apiFetch } from './api'

// A-51: AI個人フィードバックの生成をリクエストする（非同期、202）
export function requestPersonalAiFeedback(userId: number): Promise<{ status: string; job_id: number }> {
  return apiFetch(`/api/reports/personal/${userId}/ai-feedback`, { method: 'POST' })
}
