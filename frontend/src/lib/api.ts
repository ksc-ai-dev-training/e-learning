// APIクライアント（fetchラッパー）。401は共通処理で /login へリダイレクトする（詳細設計書 8.2）

export class ApiError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.location.href = '/login'
  }
  if (!res.ok) {
    let detail = 'エラーが発生しました'
    try {
      const body = await res.json()
      if (body.detail) detail = body.detail
    } catch {
      // JSONでないレスポンスは汎用メッセージのまま
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// A-20（PUT /source）専用。リクエスト/レスポンスとも text/plain のため apiFetch は使わない
export async function apiFetchText(path: string, body: string): Promise<string> {
  const res = await fetch(path, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  })
  if (res.status === 401) {
    window.location.href = '/login'
  }
  if (!res.ok) {
    let detail = 'エラーが発生しました'
    try {
      const errBody = await res.json()
      if (errBody.detail) detail = errBody.detail
    } catch {
      // JSONでないレスポンスは汎用メッセージのまま
    }
    throw new ApiError(res.status, detail)
  }
  return res.text()
}
