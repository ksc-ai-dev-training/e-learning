import useSWR from 'swr'
import { apiFetch } from '../lib/api'

export interface PresenceOther {
  user_id: number
  name: string
  seconds_ago: number
}

interface PresenceResponse {
  updated_at: string
  others: PresenceOther[]
}

// A-97: S-05/S-17編集画面の在席確認・更新検知ハートビート。悲観ロックではなく
// advisoryな警告のみ（他ユーザーの在席・自分がロードした後にupdated_atが変わったかどうか）。
// materialIdがnullの間（新規作成でまだ保存していない）は呼ばない（2026-09-10）。
export function useMaterialEditPresence(materialId: number | null, loadedUpdatedAt: string | null) {
  const { data } = useSWR<PresenceResponse>(
    materialId !== null ? `/api/materials/${materialId}/presence` : null,
    (url: string) => apiFetch<PresenceResponse>(url, { method: 'POST' }),
    { refreshInterval: 15000 },
  )
  const changedSinceLoad =
    loadedUpdatedAt !== null && data !== undefined && data.updated_at !== loadedUpdatedAt
  return { others: data?.others ?? [], changedSinceLoad }
}
