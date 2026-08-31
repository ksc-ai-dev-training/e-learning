export type Role = 'member' | 'admin'

// A-04 GET /api/auth/me のレスポンス
export interface Me {
  id: number
  email: string
  name: string
  role: Role
  picture_url: string | null
}

// GET /api/auth/dev-users のitems（開発用ログインのアカウント選択に使用）
export interface DevUser {
  email: string
  name: string
  role: Role
}

export type MaterialStatus = 'draft' | 'published'

// A-21 GET /api/projects/{project_id}/materials/source のitems
export interface MaterialSource {
  id: number
  title: string
  status: MaterialStatus
  is_archived: boolean
  updated_at: string
  tags: string[]
  chapter_count: number
  page_count: number
}

export type EnrollmentStatus = 'not_started' | 'in_progress' | 'completed'

// A-14 GET /api/materials（学習者向け一覧・検索、S-03）のitems
export interface MaterialSearchItem {
  id: number
  title: string
  description: string | null
  tags: string[]
  project_id: number
  project_name: string
  is_company_wide: boolean
  chapter_count: number
  page_count: number
  question_count: number
  question_types: QuestionType[]
  required: boolean
  progress_status: EnrollmentStatus
  // マイ学習への登録有無（F-31）。全社Wiki所属の任意教材の行にのみ登録ボタンを出す判定に使う
  registered: boolean
  updated_at: string
}

// A-14のレスポンス
export interface MaterialSearchResponse {
  items: MaterialSearchItem[]
  total: number
  available_tags: string[]
}

export type NextAction = 'start' | 'resume' | 'review'

// A-39 GET /api/my-learning のitems（S-02マイ学習、必修・任意・学習履歴で共通）
export interface MyLearningItem {
  id: number
  title: string
  tags: string[]
  project_id: number
  project_name: string
  is_company_wide: boolean
  page_count: number
  required: boolean
  due_at: string | null
  progress_status: EnrollmentStatus
  completed_page_count: number
  progress_pct: number
  next_action: NextAction
  completed_at: string | null
  updated_at: string | null
  // 必修/任意一覧（history=false）のみ。学習履歴（history=true）では常にundefined
  registered?: boolean
}

// A-39のレスポンス（history=false）
export interface MyLearningResponse {
  required: MyLearningItem[]
  optional: MyLearningItem[]
  stats: {
    required_completion_pct: number
    urgent_required_count: number
    optional_completed_count: number
    last_activity_at: string | null
  }
}

export type QuestionType = 'single' | 'multi' | 'free_text' | 'code' | 'reorder' | 'score_log'

// T-10 questions。今回のスコープで画面から作成・編集できるのはsingle/multi/reorderの3種のみ
// （free_text/code/score_logはQuestionEditCard上で選択自体はできるが保存はブロックされる）
export interface Question {
  id: number | null
  type: QuestionType
  prompt: string
  options: string[] | null
  correct_answer: string | string[] | null
  scoring_criteria: string | null
  code_language: string | null
  required: boolean
  is_critical: boolean
  feedback_style: 'show_answer' | 'review_only' | 'hint_only' | null
  score_unit: string | null
  grading_mode: 'ai' | 'manual' | null
  pool_group: number | null
}

export type ContentKind = 'explanation' | 'quiz' | 'mixed'
export type QuizMode = 'all' | 'pool'

// A-15 GET /api/materials/{id} の toc 内の1ノード（章・小見出し・ページ）。
// content_kind以降はkind='page'のみ意味を持つ（chapter/sectionは常にnull/既定値/空配列）
export interface MaterialNode {
  id: number
  parent_node_id: number | null
  title: string
  kind: 'chapter' | 'section' | 'page'
  sort_order: number
  content_kind: ContentKind | null
  format: 'markdown' | 'html' | null
  body: string | null
  quiz_mode: QuizMode
  pool_draw_count: number | null
  questions: Question[]
  children: MaterialNode[]
}

// A-40等の受講進捗（enrollment_progress）。A-15レスポンスのprogressフィールドに含まれる
export interface EnrollmentProgress {
  status: 'not_started' | 'in_progress' | 'completed'
  current_node_id: number | null
  completed_node_ids: number[]
}

// A-40〜A-43（受講・受験、S-16）のレスポンス
export interface QuizAttempt {
  id: number
  user_id: number
  material_id: number
  scope_node_id: number | null
  mode: 'graded' | 'practice'
  attempt_no: number
  score_pct: number | null
  passed: boolean | null
  fail_reason: string | null
  question_order: Record<string, number[]>
  carried_over_question_ids: number[]
  started_at: string
  submitted_at: string | null
}

export interface Answer {
  id: number
  attempt_id: number
  question_id: number
  response: unknown
  is_correct: boolean | null
  ai_score_pct: number | null
  ai_feedback: string | null
  reviewed_by: number | null
  reviewed_at: string | null
}

// A-86 GET /materials/{id}/attempt-summary のitems（S-04 前回の受験結果パネル・AI採点結果パネル）
export interface AttemptSummaryEntry {
  scope_node_id: number | null
  scope_label: string
  attempt: {
    id: number
    attempt_no: number
    score_pct: number | null
    passed: boolean | null
    fail_reason: string | null
    submitted_at: string
  }
  attempt_count: number
  retake_allowed: boolean
  retake_limit: number | null
  answers: {
    question_id: number
    prompt: string
    type: 'free_text' | 'code'
    is_correct: boolean | null
    ai_score_pct: number | null
    ai_feedback: string | null
  }[]
}

// A-87 GET /materials/{id}/practice-attempts のitems（S-04 反復演習タブの実施履歴）
export interface PracticeAttemptSummary {
  id: number
  score_pct: number | null
  submitted_at: string
  duration_seconds: number | null
  total_count: number
  correct_count: number
}

// A-78 GET /materials/{id}/surveys のitems
export interface SurveyQuestion {
  id: number
  type: 'rating_5' | 'single_choice' | 'free_text'
  prompt: string
  options: string[] | null
}

export interface Survey {
  id: number
  node_id: number | null
  title: string
  is_active: boolean
  repeat_mode: 'once' | 'every_time'
  answered_by_me: boolean
  questions: SurveyQuestion[]
}

// A-15/A-16/A-17 のレスポンス（教材メタ。A-15のみtoc・required・due_at・progress・page_countを含む）
export interface Material {
  id: number
  project_id: number
  title: string
  description: string | null
  tags: string[]
  status: MaterialStatus
  sort_order: number
  attempt_scope: 'material' | 'chapter' | 'section' | 'page'
  retake_scope: 'all' | 'wrong_only'
  default_feedback_style: 'show_answer' | 'review_only' | 'hint_only'
  ai_context: string | null
  grading_mode: 'ai' | 'manual'
  is_archived: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
  toc?: MaterialNode[]
  // S-04（教材受講：目次）向け。A-15のみが返す（S-04着手時に追加）
  required?: boolean
  due_at?: string | null
  progress?: EnrollmentProgress
  page_count?: number
  // マイ学習登録（F-31）向け。A-15のみが返す（S-02実装時に追加）
  is_company_wide?: boolean
  registered?: boolean
}

export type ProjectRole = 'admin' | 'editor' | 'learner'

// A-81 GET /api/projects のitems
export interface Project {
  id: number
  name: string
  is_company_wide: boolean
  role: ProjectRole
  material_published_count: number
  material_draft_count: number
  member_count: number
}

// A-11 GET /api/project-memberships のitems（S-05プロジェクトメンバータブで使用）
export interface ProjectMembership {
  id: number
  user_id: number
  user_name: string
  global_role: Role
  project_id: number
  project_name: string
  role: ProjectRole
  status: 'invited' | 'active'
  joined_at: string
  left_at: string | null
}

// A-22 GET /api/materials/{id}/revisions のitems（S-05改訂履歴タブ）
export interface MaterialRevision {
  id: number
  changed_by_name: string
  changed_via: 'web' | 'claude_code'
  change_summary: string | null
  created_at: string
}

// A-32/A-33 教材AIレビュー結果（S-05 AIレビュー結果タブ）
export interface AiReviewFinding {
  location: string
  severity: 'info' | 'warning'
  issue: string
  suggestion?: string | null
}

export interface AiMaterialReview {
  id: number
  material_id: number
  requested_by: number
  requested_by_name: string
  findings: AiReviewFinding[]
  created_at: string
}

// A-28 GET /api/materials/{id}/attachments のitems（S-05ファイル・リンクタブ）
export interface MaterialAttachment {
  id: number
  node_id: number | null
  kind: 'file' | 'link'
  filename: string
  mime_type: string | null
  size_bytes: number | null
  external_url: string | null
  created_at: string
}

// 新設GET /api/materials/{id}/questions-summary のitems（S-05「問題一覧」タブ）。
// 教材内の全設問をページ横断でフラットに集計する。正答率・pending_countはT-13/T-14参照だが、
// 受講・受験API（A-39〜A-44）が未実装のため現状は常にtotal_answers=0（配線のみ先行実装）
export interface QuestionSummaryItem {
  question_id: number
  node_id: number
  node_path: string
  type: QuestionType
  grading_mode: 'ai' | 'manual' | null
  prompt: string
  total_answers: number
  accuracy_pct: number | null
  pending_count: number
}

export type SurveyQuestionType = 'rating_5' | 'single_choice' | 'free_text'

// T-27 survey_questions。T-10 questionsと異なりcorrect_answerを持たない
export interface SurveyQuestion {
  id: number | null
  type: SurveyQuestionType
  prompt: string
  options: string[] | null
}

// A-78/A-79 GET/PUT /api/materials/{id}/surveys のitems（S-05受験後アンケート設置）。
// node_id=nullは教材全体、指定時は対象の章（kind='chapter'）
export interface Survey {
  id: number
  node_id: number | null
  title: string
  is_active: boolean
  repeat_mode: 'once' | 'every_time'
  questions: SurveyQuestion[]
}
