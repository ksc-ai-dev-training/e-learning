import useSWR from 'swr'
import { apiFetch } from '../lib/api'
import type { Material } from '../types'

// A-15: 教材メタ＋目次ツリー。idがnullの間（新規作成でまだ保存していない）は取得しない
export function useMaterial(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<Material>(
    id !== null ? `/api/materials/${id}` : null,
    apiFetch,
  )
  return { material: data, error, isLoading, mutate }
}
