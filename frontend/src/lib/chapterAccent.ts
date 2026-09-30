// 章カードの左端に付ける控えめなアクセントカラー（Sidebar.tsxのACCENT_ICON_CLASSと同じ
// 考え方）。章の識別だけに使い、ページ・小見出し行の配色は変えない（2026-09-09、目次の
// 見やすさ改善）。章indexで順番に割り当てるため、並び替え後も位置に応じて再割り当てされる。
// 教材編集（S-05, MaterialEdit.tsx）・受講者向け目次（S-04, MaterialView.tsx）の両方で同じ配色に
// なるよう共通化している。Sidebar.tsxのACCENT_ICON_CLASS（青・紫・緑・琥珀）とほぼ同じ色相を
// 使っていたため、「章の区別」なのか「サイドバーの分類」なのか紛らわしいという指摘を受け、
// サイドバーで使っていない色相のみに総入れ替えした（2026-09-09）。
const CHAPTER_ACCENT_CLASSES = [
  'border-l-teal-300',
  'border-l-orange-300',
  'border-l-cyan-300',
  'border-l-fuchsia-300',
  'border-l-lime-300',
]

export function chapterAccentClass(chapterIdx: number): string {
  return CHAPTER_ACCENT_CLASSES[chapterIdx % CHAPTER_ACCENT_CLASSES.length]
}
