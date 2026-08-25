import { Link, useParams } from 'react-router'
import PageHeader from '../components/layout/PageHeader'
import Badge from '../components/ui/Badge'
import { useMaterials } from '../hooks/useMaterials'
import { useProjects } from '../hooks/useProjects'

// S-14 教材編集：教材一覧（詳細設計書10.13節）。
// 「＋新規教材を作成」の遷移先S-05はまだ無いため、ボタンは現状クリックできない。
export default function MaterialsList() {
  const { projectId } = useParams<{ projectId: string }>()
  const id = Number(projectId)
  const { projects } = useProjects()
  const { materials, error, isLoading } = useMaterials(id)
  const project = projects.find((p) => p.id === id)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={`教材編集${project ? ` — ${project.name}` : ''}`} />
      <div className="px-8 py-6">
        <p className="mb-4 text-[11.5px] text-slate-400">
          <Link to="/materials/edit-projects" className="text-blue-800 hover:underline">
            ← プロジェクト選択に戻る
          </Link>
          {' ／ '}
          このプロジェクトの教材（下書きを含む）を一覧表示します。
        </p>

        <div className="mb-4 flex items-center gap-2.5">
          <span
            className="cursor-not-allowed rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-400"
            title="準備中（S-05実装後に有効化）"
          >
            ＋ このプロジェクトに新規教材を作成
          </span>
          <span className="text-xs text-slate-400">または、下の一覧から既存の教材を編集</span>
        </div>

        {isLoading && <p className="text-sm text-slate-400">読み込み中...</p>}
        {error && <p className="text-sm text-red-600">教材一覧を取得できませんでした</p>}

        {!isLoading && !error && materials.length === 0 && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            教材がありません。「＋ このプロジェクトに新規教材を作成」から作成してください。
          </p>
        )}

        {materials.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-semibold">教材</th>
                  <th className="w-24 px-3 py-2 font-semibold">状態</th>
                  <th className="w-28 px-3 py-2 font-semibold">更新日</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">{m.title}</td>
                    <td className="px-3 py-2">
                      <Badge variant={m.status === 'published' ? 'published' : 'draft'} />
                    </td>
                    <td className="px-3 py-2 text-slate-500">{m.updated_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
