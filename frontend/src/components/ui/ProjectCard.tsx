import { Link } from 'react-router'
import type { Project } from '../../types'

const ROLE_LABELS: Record<string, string> = {
  admin: '管理者',
  editor: '編集者',
  learner: '受講者',
}

// プロジェクトの選択カード（詳細設計書2.1.2節）。S-13教材編集：プロジェクト選択で使用。
// 選択でS-14（教材一覧）へ遷移する。
export default function ProjectCard({ project, pinned }: { project: Project; pinned?: boolean }) {
  return (
    <Link
      to={`/projects/${project.id}/materials/edit`}
      className={`flex flex-col gap-2 rounded-lg border p-4 no-underline dark:hover:border-blue-500 ${
        pinned
          ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
          : 'border-slate-300 bg-white hover:border-blue-700 dark:border-slate-700 dark:bg-slate-900'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900 dark:text-slate-50">
          {pinned && (
            <svg
              className="h-[13px] w-[13px] flex-shrink-0 text-blue-700 dark:text-blue-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="17" x2="12" y2="22" />
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
            </svg>
          )}
          {project.name}
        </span>
        <span className="rounded border border-dashed border-slate-300 px-1.5 text-xs font-semibold text-orange-700 dark:border-slate-600 dark:text-orange-300">
          {ROLE_LABELS[project.role]}
        </span>
      </div>
      <span className="text-[13px] text-slate-400 dark:text-slate-300">
        {project.is_company_wide
          ? '全社員が自動参加'
          : `教材${project.material_published_count + project.material_draft_count}件（公開${project.material_published_count}・下書き${project.material_draft_count}）／ メンバー${project.member_count}名`}
      </span>
    </Link>
  )
}
