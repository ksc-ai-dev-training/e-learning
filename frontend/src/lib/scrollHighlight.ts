// 「一覧を見る」等のリンク・ボタンから、同一画面内の対象セクションへスクロールしたときの
// フィードバック共通処理。データが少なく元々スクロールが不要な場合でも、クリックへの反応が
// 常に視覚的にわかるよう、対象セクションを一瞬ハイライトする（インラインstyleで直接操作し、
// Tailwindのクラス名をJSで動的生成しない。動的クラス名はビルド時のJITスキャンに拾われず
// 効かないため）。（2026-09-03、ユーザー指摘を受け追加）
const HIGHLIGHT_MS = 1200
const TRANSITION_MS = 300

export function scrollToAndHighlight(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const prevTransition = el.style.transition
  const prevBackground = el.style.backgroundColor
  const prevBoxShadow = el.style.boxShadow
  const prevBorderRadius = el.style.borderRadius

  el.style.transition = `background-color ${TRANSITION_MS}ms ease, box-shadow ${TRANSITION_MS}ms ease`
  el.style.backgroundColor = '#eff6ff'
  el.style.boxShadow = '0 0 0 3px #bfdbfe'
  el.style.borderRadius = prevBorderRadius || '6px'

  window.setTimeout(() => {
    el.style.backgroundColor = prevBackground
    el.style.boxShadow = prevBoxShadow
    window.setTimeout(() => {
      el.style.transition = prevTransition
      el.style.borderRadius = prevBorderRadius
    }, TRANSITION_MS)
  }, HIGHLIGHT_MS)
}

// href="#xxx" のクリックをネイティブのハッシュ遷移に任せず、この共通処理で扱うための
// クリックハンドラ。ネイティブのハッシュ遷移はスクロール対象が入れ子のoverflow-y-autoコンテナ
// （AppShellのレイアウト、documentそのものはoverflow-hiddenでスクロールしない）だと
// ブラウザによって挙動が不安定なため、常にscrollIntoViewで明示的に処理する。
export function handleHashLinkClick(e: React.MouseEvent<HTMLAnchorElement>, id: string): void {
  e.preventDefault()
  window.history.replaceState(null, '', `#${id}`)
  scrollToAndHighlight(id)
}
