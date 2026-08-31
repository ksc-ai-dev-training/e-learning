// S-02マイ学習から受講に入った場合、S-04/S-16の「教材一覧に戻る」「一時中断する」の戻り先を
// マイ学習にするための共通ヘルパー。S-02の各操作ボタンは`?from=my-learning`を付けて遷移する。
export const FROM_MY_LEARNING = 'my-learning'

export function backTarget(from: string | null): { to: string; label: string } {
  if (from === FROM_MY_LEARNING) {
    return { to: '/', label: '← マイ学習に戻る' }
  }
  return { to: '/materials', label: '← 教材一覧に戻る' }
}

// S-04内のページ遷移リンク（目次行・続きから受講等）にfromを引き継がせるためのクエリ文字列
export function fromQuery(from: string | null): string {
  return from === FROM_MY_LEARNING ? `?from=${FROM_MY_LEARNING}` : ''
}

// 遷移先のURLに既に?mode=等のクエリが付いている場合に&で連結するためのクエリ文字列
export function andFromQuery(from: string | null): string {
  return from === FROM_MY_LEARNING ? `&from=${FROM_MY_LEARNING}` : ''
}
