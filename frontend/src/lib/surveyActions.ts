import { apiFetch } from './api'
import type { Survey, SurveyQuestion } from '../types'

// A-78/A-79: S-05受験後アンケート設置の登録・削除（呼び出し側でuseSurveysのmutate()を呼ぶ）。

export async function upsertSurvey(
  materialId: number,
  survey: {
    node_id: number | null
    title: string
    is_active: boolean
    repeat_mode: 'once' | 'every_time'
    questions: SurveyQuestion[]
  },
): Promise<{ id: number }> {
  return apiFetch<{ id: number }>(`/api/materials/${materialId}/surveys`, {
    method: 'PUT',
    body: JSON.stringify(survey),
  })
}

export async function deleteSurvey(materialId: number, surveyId: number): Promise<void> {
  await apiFetch(`/api/materials/${materialId}/surveys/${surveyId}`, { method: 'DELETE' })
}

export function emptySurveyQuestion(type: SurveyQuestion['type']): SurveyQuestion {
  return {
    id: null,
    type,
    prompt: '',
    options: type === 'single_choice' ? ['', ''] : null,
  }
}

export type { Survey }
