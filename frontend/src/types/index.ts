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
