import useSWR from 'swr'
import { listCliKeys } from '../lib/cliKeyActions'
import type { CliTokenItem } from '../types'

// 自分が発行したCLIトークンの一覧（プロフィール画面の鍵管理パネル用）
export function useCliTokens() {
  const { data, error, isLoading, mutate } = useSWR<{ items: CliTokenItem[] }>(
    '/api/auth/cli/tokens',
    listCliKeys,
  )
  return { tokens: data?.items ?? [], error, isLoading, mutate }
}
