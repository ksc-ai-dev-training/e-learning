import PageHeader from '../components/layout/PageHeader'
import ProjectCard from '../components/ui/ProjectCard'
import { useProjects } from '../hooks/useProjects'

// S-13 教材編集：プロジェクト選択（詳細設計書10.12節）。カード選択でS-14へ遷移する予定だが、
// S-14は未実装のため現状はクリックできない（縦切り実装の途中経過）。
export default function ProjectSelect() {
  const { projects, error, isLoading } = useProjects()

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="教材編集" screenId="S-13" />
      <div className="px-8 py-6">
        <p className="mb-4 text-[11.5px] text-slate-400">
          編集する教材が属するプロジェクトを選ぶ。全社員が「全社公開」の編集者を自動的に持つため、このメニューは常に表示される。
        </p>

        {isLoading && <p className="text-sm text-slate-400">読み込み中...</p>}
        {error && <p className="text-sm text-red-600">プロジェクト一覧を取得できませんでした</p>}

        <div className="grid grid-cols-2 gap-3.5">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} pinned={project.is_company_wide} />
          ))}
        </div>
      </div>
    </div>
  )
}
