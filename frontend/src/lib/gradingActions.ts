import { apiFetch } from './api'

// A-74: 設問1件の採点結果を確定・修正する（S-20「採点する」）
export function reviewAnswer(
  answerId: number,
  body: { is_correct: boolean; ai_feedback: string },
): Promise<{ detail: string }> {
  return apiFetch(`/api/answers/${answerId}/review`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// A-98: 採点結果を確認済みにする（S-04を開いたときに呼ぶ。マイ学習「採点結果未確認」ボックスから外れる）
export function ackGradingResults(materialId: number): Promise<{ detail: string }> {
  return apiFetch(`/api/materials/${materialId}/grading-results/ack`, {
    method: 'POST',
  })
}
