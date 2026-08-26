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
  updated_at: string
  tags: string[]
  chapter_count: number
  page_count: number
}

// A-15 GET /api/materials/{id} の toc 内の1ノード（章・小見出し。ページはS-17着手時に追加）
export interface MaterialNode {
  id: number
  parent_node_id: number | null
  title: string
  kind: 'chapter' | 'section' | 'page'
  sort_order: number
  children: MaterialNode[]
}

// A-15/A-16/A-17 のレスポンス（教材メタ。A-15のみtocを含む）
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
  created_at: string
  updated_at: string
  toc?: MaterialNode[]
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
