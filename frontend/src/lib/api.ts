// APIクライアント（fetchラッパー）。401は共通処理で /login へリダイレクトする（詳細設計書 8.2）

export class ApiError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}

// エラーレスポンスのdetailからユーザーに見せられる文字列を取り出す。アプリ独自のHTTPException
// （detailは常に文字列）だけでなく、FastAPIが自動生成するリクエストバリデーションエラー
// （422。detailは{"type","loc","msg",...}の配列）にも対応する（2026-09-16、ユーザー報告により
// 発見・修正。プロジェクト名の文字数上限を超えて保存すると、配列のdetailをそのままError
// メッセージにしていたためJavaScriptの既定のtoString化で「[object Object]」と表示されていた）。
function extractErrorDetail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('detail' in body)) return null
  const detail = (body as { detail: unknown }).detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) =>
        item && typeof item === 'object' && 'msg' in item ? String((item as { msg: unknown }).msg) : null,
      )
      .filter((m): m is string => m !== null)
    if (messages.length > 0) return messages.join(' / ')
  }
  return null
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
      const extracted = extractErrorDetail(body)
      if (extracted) detail = extracted
    } catch {
      // JSONでないレスポンスは汎用メッセージのまま
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// A-20（PUT /source）専用。リクエスト/レスポンスとも text/plain のため apiFetch は使わない
export async function apiFetchText(
  path: string,
  body: string,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const res = await fetch(path, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders },
    body,
  })
  if (res.status === 401) {
    window.location.href = '/login'
  }
  if (!res.ok) {
    let detail = 'エラーが発生しました'
    try {
      const errBody = await res.json()
      const extracted = extractErrorDetail(errBody)
      if (extracted) detail = extracted
    } catch {
      // JSONでないレスポンスは汎用メッセージのまま
    }
    throw new ApiError(res.status, detail)
  }
  return res.text()
}

// 保存時の楽観的ロック競合（409）を、他のエラーと区別してユーザーに分かりやすく伝える
// （2026-09-10、複数人での同時編集による無条件上書き事故対策の一部）。
export function conflictAwareMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.status === 409) {
    return (
      '他のユーザーがこの教材を更新したため、保存できませんでした。画面を再読み込みしてから、' +
      '内容をご確認のうえ、必要な変更を行って保存し直してください（入力中の内容はそのまま残っています）。'
    )
  }
  return e instanceof ApiError ? e.message : fallback
}
