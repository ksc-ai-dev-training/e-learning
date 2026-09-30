import { useEffect, useState } from 'react'

const THEME_KEY = 'manabi-theme'
type Theme = 'light' | 'dark'

// ダークモードの切り替え（サイドバーに設置。2026-09-17新設）。index.htmlの
// 初期化スクリプトが描画前にlocalStorageの値をhtml要素へ反映済みのため、ここでは
// その状態を読み取ってReact側のstateと同期させるだけでよい。
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return { theme, toggleTheme }
}
