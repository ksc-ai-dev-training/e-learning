// 教材一覧・検索（S-03）で、教材ごとのプロジェクト表示を一目で区別できるようにするための
// プロジェクトID→色割り当て。project_idを固定パレットの長さで割った余りで決めるだけの単純な
// 決定的割り当てのため、同じプロジェクトは常に同じ色になるが、色自体に意味（重要度等）は無い。
// クラス名は完全な文字列のままここに書く必要がある（TailwindのJITスキャナは実行時に組み立てた
// 文字列の断片を検出できないため）。
const PALETTE = [
  'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200',
  'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
  'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200',
  'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200',
  'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200',
  'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200',
]

export function projectColorClasses(projectId: number): string {
  return PALETTE[projectId % PALETTE.length]
}
