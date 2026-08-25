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
