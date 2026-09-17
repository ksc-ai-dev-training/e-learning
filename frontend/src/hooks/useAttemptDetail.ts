import useSWR from 'swr'
import { getAttempt } from '../lib/attemptActions'

// A-43: 練習・誤答＆難問抽出の実施履歴「詳細」表示向け。attemptIdがnullの間は取得しない
// （履歴の行を開いたときだけ取得する。2026-09-17）
export function useAttemptDetail(attemptId: number | null) {
  const { data, error, isLoading } = useSWR(
    attemptId !== null ? ['attempt-detail', attemptId] : null,
    () => getAttempt(attemptId as number),
  )
  return { attempt: data ?? null, error, isLoading }
}
