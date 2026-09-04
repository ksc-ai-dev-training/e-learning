import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import { useMe } from '../hooks/useMe'
import type { DevUser } from '../types'

const ROLE_LABELS: Record<string, string> = {
  admin: '管理者',
  member: '一般',
}

// A-02 が認証を拒否したときに ?error= で渡してくる種別に対応するメッセージ（詳細設計書4.1節）
const LOGIN_ERRORS: Record<string, string> = {
  domain: 'kogasoftware.com のアカウントでログインしてください。',
  inactive: 'このアカウントは無効化されています。管理者にお問い合わせください。',
  forbidden: 'このアカウントではログインできません。',
  invalid_request: '認証処理に失敗しました。お手数ですが、もう一度お試しください。',
}

// S-01 ログイン画面。ローカル開発では Google 認証の代わりに開発用ログインを表示する
export default function Login() {
  const navigate = useNavigate()
  const { mutate } = useMe()
  const [error, setError] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const { data } = useSWR<{ items: DevUser[] }>('/api/auth/dev-users', apiFetch)

  // Google認証が拒否された場合は A-02 から /login?error=... に戻ってくる
  const authError = searchParams.get('error')
  const authErrorMessage = authError
    ? (LOGIN_ERRORS[authError] ?? LOGIN_ERRORS.invalid_request)
    : null

  const devLogin = async (email: string) => {
    setError(null)
    try {
      await apiFetch('/api/auth/dev-login', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      await mutate()
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ログインに失敗しました')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-9 py-10 text-center shadow-md">
        <div className="mx-auto mb-3.5 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-900 text-lg font-bold text-white">
          M
        </div>
        <h1 className="text-xl font-bold tracking-wide text-slate-900">Manabi</h1>
        <p className="mb-7 mt-1 text-xs text-slate-500">社内学習管理システム</p>

        {authErrorMessage && (
          <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-700">
            {authErrorMessage}
          </p>
        )}

        <a
          href="/api/auth/login"
          className="flex h-[42px] w-full items-center justify-center gap-2.5 rounded border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Googleでログイン
        </a>
        <p className="mt-4 text-[11.5px] text-slate-400">@kogasoftware.com アカウントのみ利用できます</p>

        {data && (
          <div className="mt-8 border-t border-slate-200 pt-4">
            <p className="mb-2 text-left text-xs font-semibold text-amber-600">
              開発用ログイン（Google認証の代替）
            </p>
            <ul className="space-y-1">
              {data.items.map((u) => (
                <li key={u.email}>
                  <button
                    onClick={() => devLogin(u.email)}
                    className="flex w-full items-center justify-between rounded border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span>
                      {u.name}
                      <span className="ml-2 text-xs text-slate-400">{u.email}</span>
                    </span>
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">
                      {ROLE_LABELS[u.role]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}

        <div className="mt-7 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
          コガソフトウェア株式会社 社内システム
        </div>
      </div>
    </div>
  )
}
