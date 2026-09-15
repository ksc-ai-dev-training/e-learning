// コード記述式設問のcode_languageは設問作成者の自由入力文字列（固定の選択肢ではない）ため、
// 表記ゆれ（大文字小文字・略称・"C++"のような記号）を吸収してPrismの言語名に変換する。
// 対応表にない言語はハイライトなしのプレーンテキストにフォールバックする
// （CodeAnswerEditor側でPrism.languages[name]がnullならハイライトを行わない）。
const ALIASES: Record<string, string> = {
  python: 'python',
  py: 'python',
  javascript: 'javascript',
  js: 'javascript',
  node: 'javascript',
  nodejs: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  java: 'java',
  c: 'c',
  'c++': 'cpp',
  cpp: 'cpp',
  'c#': 'csharp',
  csharp: 'csharp',
  cs: 'csharp',
  go: 'go',
  golang: 'go',
  sql: 'sql',
  bash: 'bash',
  shell: 'bash',
  sh: 'bash',
}

export function resolvePrismLanguage(codeLanguage: string | null | undefined): string | null {
  if (!codeLanguage) return null
  const key = codeLanguage.trim().toLowerCase().replace(/\s+/g, '')
  return ALIASES[key] ?? null
}
