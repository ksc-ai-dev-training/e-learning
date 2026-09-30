import { apiFetch } from './api'

// A-74: 設問1件の採点結果を自動保存する（S-20まとめ採点カード内の1問）。受講者にはまだ見えない。
// 2026-09-16、明示的な「仮保存」ボタンを廃止し自動保存化したのに合わせ、is_correct未選択の
// 状態でもフィードバック文だけ保存できるようnullを許容するようにした（is_correctがnullの場合、
// バックエンドは既存の下書き正誤判定を上書きせずフィードバックのみ更新する）。
export function saveDraftReview(
  answerId: number,
  body: { is_correct: boolean | null; ai_feedback: string },
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
