import type { Question, QuestionType } from '../types'

const TYPE_LABELS: Record<QuestionType, string> = {
  single: '単一選択',
  multi: '複数選択',
  reorder: '並び替え',
  free_text: '記述式',
  code: 'コード記述式',
  score_log: 'スコア記録',
}

export function questionTypeLabel(type: QuestionType): string {
  return TYPE_LABELS[type] ?? type
}

export function isQuestionTypeSupported(_type: QuestionType): boolean {
  return true
}

// 記述式・コード記述式のみ教材既定の採点方式（materials.grading_mode）を上書きできる（8.3節）
export function supportsGradingModeOverride(type: QuestionType): boolean {
  return type === 'free_text' || type === 'code'
}

export function emptyQuestionForType(type: QuestionType): Question {
  return {
    id: null,
    type,
    prompt: '',
    options: type === 'single' || type === 'multi' ? ['', ''] : null,
    correct_answer: type === 'reorder' ? ['', ''] : type === 'multi' ? [] : null,
    scoring_criteria: type === 'free_text' || type === 'code' ? '' : null,
    code_language: type === 'code' ? '' : null,
    required: true,
    is_critical: false,
    feedback_style: null,
    score_unit: type === 'score_log' ? '' : null,
    grading_mode: null,
    pool_group: null,
  }
}
