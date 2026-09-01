import { Navigate, Route, Routes } from 'react-router'
import { useMe } from './hooks/useMe'
import Login from './pages/Login'
import MyLearning from './pages/MyLearning'
import ProjectSelect from './pages/ProjectSelect'
import MaterialsList from './pages/MaterialsList'
import MaterialsSearch from './pages/MaterialsSearch'
import MaterialView from './pages/MaterialView'
import MaterialPageView from './pages/MaterialPageView'
import MaterialEdit from './pages/MaterialEdit'
import MaterialPreview from './pages/MaterialPreview'
import MaterialPageEdit from './pages/MaterialPageEdit'
import ProjectCreate from './pages/ProjectCreate'
import ProjectManagement from './pages/ProjectManagement'
import AssignmentSettings from './pages/AssignmentSettings'
import AppShell from './components/layout/AppShell'

// ルーティング定義・認証ガード。
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
        <Route path="/" element={<MyLearning />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/materials/edit-projects" element={<ProjectSelect />} />
        <Route path="/materials" element={<MaterialsSearch />} />
        <Route path="/materials/:materialId" element={<MaterialView />} />
        <Route path="/materials/:materialId/pages/:nodeId" element={<MaterialPageView />} />
        <Route path="/projects/:projectId/materials/edit" element={<MaterialsList />} />
        <Route path="/projects/:projectId/materials/:materialId/edit" element={<MaterialEdit />} />
        <Route path="/projects/:projectId/materials/:materialId/preview" element={<MaterialPreview />} />
        <Route
          path="/projects/:projectId/materials/:materialId/pages/:nodeId/edit"
          element={<MaterialPageEdit />}
        />
        <Route path="/projects/new" element={<ProjectCreate />} />
        <Route path="/projects/manage" element={<ProjectManagement />} />
        <Route path="/projects/:projectId/manage" element={<ProjectManagement />} />
        <Route path="/assignments" element={<AssignmentSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
