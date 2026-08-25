import { Navigate, Route, Routes } from 'react-router'
import { useMe } from './hooks/useMe'
import Login from './pages/Login'

// ルーティング定義・認証ガード。S-02以降の画面はまだ無いため、ログイン後の行き先は仮表示。
export default function App() {
  const { me, isLoading } = useMe()

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-slate-400">読み込み中...</div>
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <div className="p-8 text-center text-sm text-slate-600">
      ログイン中: {me.name}（{me.email}）
      <p className="mt-2 text-xs text-slate-400">S-02以降の画面は未実装です。</p>
    </div>
  )
}
