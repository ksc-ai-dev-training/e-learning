import { useState } from 'react'
import PageHeader from '../components/layout/PageHeader'
import ProjectCard from '../components/ui/ProjectCard'
import TextInput from '../components/ui/TextInput'
import { useProjects } from '../hooks/useProjects'

// S-13 教材編集：プロジェクト選択（詳細設計書10.12節）。カード選択でS-14へ遷移する。
export default function ProjectSelect() {
  const { projects, error, isLoading } = useProjects()
  const [keyword, setKeyword] = useState('')

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(keyword.toLowerCase()))

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="教材編集" />
      <div className="px-8 py-6">
        <p className="mb-4 text-[11.5px] text-slate-400">
          編集する教材が属するプロジェクトを選ぶ。全社員が「全社Wiki」の編集者を自動的に持つため、このメニューは常に表示される。
        </p>

        <div className="mb-4 flex max-w-xs flex-col gap-1">
          <label htmlFor="project-search" className="text-xs font-semibold text-slate-500">
            プロジェクト名で検索
          </label>
          <TextInput
            id="project-search"
            type="search"
            placeholder="プロジェクト名"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        {isLoading && <p className="text-sm text-slate-400">読み込み中...</p>}
        {error && <p className="text-sm text-red-600">プロジェクト一覧を取得できませんでした</p>}

        {!isLoading && !error && filtered.length === 0 && (
          <p className="text-sm text-slate-400">該当するプロジェクトがありません。</p>
        )}

        <div className="grid grid-cols-2 gap-3.5">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} pinned={project.is_company_wide} />
          ))}
        </div>
      </div>
    </div>
  )
}
