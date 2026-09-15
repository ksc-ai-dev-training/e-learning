import { apiFetch } from './api'

// A-74: 設問1件の採点結果を下書き保存する（S-20まとめ採点カード内の1問）。受講者にはまだ見えない。
export function saveDraftReview(
  answerId: number,
  body: { is_correct: boolean; ai_feedback: string },
): Promise<{ detail: string }> {
  return apiFetch(`/api/answers/${answerId}/review`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// 新規: 受験記録内の下書きをすべて確定し、受講者に公開する（S-20「採点結果を送信」）
export function finalizeAttemptGrading(attemptId: number): Promise<{ detail: string }> {
  return apiFetch(`/api/attempts/${attemptId}/grading/finalize`, {
    method: 'POST',
  })
}

// A-98: 採点結果を確認済みにする（S-04を開いたときに呼ぶ。マイ学習「採点結果未確認」ボックスから外れる）
export function ackGradingResults(materialId: number): Promise<{ detail: string }> {
  return apiFetch(`/api/materials/${materialId}/grading-results/ack`, {
    method: 'POST',
  })
}
