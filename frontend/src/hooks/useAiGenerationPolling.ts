import { useEffect, useState } from 'react'
import type { KeyedMutator } from 'swr'
import { ApiError } from '../lib/api'

const GENERATING_SLOW_AFTER_MS = 3 * 60 * 1000

// AI生成（A-48 AI組織レポート・A-51 AI個人フィードバック）に共通する「生成開始→SWRポーリングで
// 結果を待つ→3分経っても終わらない場合はスロー警告を出す」パターンを1つにまとめた
// （2026-09-28。Dashboard.tsx・PersonalReport.tsxで行単位まで一致する実装が重複しており、
// 一方だけ直して他方に反映し忘れるおそれがあったため共通化した）。
//
// generating状態自体は、SWRフック（useOrgReport/usePersonalAiFeedback）へのpolling引数として
// 呼び出し側が先に必要とするため、呼び出し側のuseStateとして持たせ、このフックには
// [値, セッター]を渡す（フック内部で完結させると、SWRフックへ渡す値とこのフックが管理する値が
// 循環参照になってしまうため）。
export function useAiGenerationPolling<T>(
  generating: boolean,
  setGenerating: (value: boolean) => void,
  result: T | null | undefined,
  mutate: KeyedMutator<T | null>,
  requestFn: () => Promise<unknown>,
  errorMessage: string,
) {
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [slowWarning, setSlowWarning] = useState(false)

  useEffect(() => {
    if (generating && result) setGenerating(false)
  }, [generating, result, setGenerating])

  useEffect(() => {
    if (!generating) {
      setSlowWarning(false)
      return
    }
    const timer = setTimeout(() => setSlowWarning(true), GENERATING_SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [generating])

  const generate = async () => {
    setGenerateError(null)
    setSlowWarning(false)
    setGenerating(true)
    try {
      // 既存の結果がある状態からの再生成時、SWRのキャッシュにデータが残ったままだと
      // ポーリング条件（!data）を満たさずポーリングが再開しない。ここで一旦クリアしてから
      // リクエストし、改めて取得し直す。
      await mutate(null, false)
      await requestFn()
      await mutate()
    } catch (e) {
      setGenerateError(e instanceof ApiError ? e.message : errorMessage)
      setGenerating(false)
    }
  }

  return { generateError, slowWarning, generate }
}
