import { Navigate, Route, Routes } from 'react-router'
import { useMe } from './hooks/useMe'
import Login from './pages/Login'
import ProjectSelect from './pages/ProjectSelect'
import MaterialsList from './pages/MaterialsList'
import MaterialEdit from './pages/MaterialEdit'
import MaterialPageEdit from './pages/MaterialPageEdit'
import AppShell from './components/layout/AppShell'

// ルーティング定義・認証ガード。S-02（マイ学習、本来"/"）は未実装のため、
// 暫定的に"/"をS-13（今のところ唯一実装済みの画面）へリダイレクトする。
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
    <AppShell me={me}>
      <Routes>
        <Route path="/" element={<Navigate to="/materials/edit-projects" replace />} />
        <Route path="/login" element={<Navigate to="/materials/edit-projects" replace />} />
        <Route path="/materials/edit-projects" element={<ProjectSelect />} />
        <Route path="/projects/:projectId/materials/edit" element={<MaterialsList />} />
        <Route path="/projects/:projectId/materials/:materialId/edit" element={<MaterialEdit />} />
        <Route
          path="/projects/:projectId/materials/:materialId/pages/:nodeId/edit"
          element={<MaterialPageEdit />}
        />
        <Route path="*" element={<Navigate to="/materials/edit-projects" replace />} />
      </Routes>
    </AppShell>
  )
}
