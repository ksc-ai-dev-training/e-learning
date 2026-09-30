import { useEffect, useRef, useState } from 'react'
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
//
// 更新検知の基準値は、教材データ自体のupdated_at（呼び出し元のmutate()タイミング次第で
// 更新有無がバラつく）ではなく、このフック自身が受け取ったポーリング結果を基準にする
// （2026-09-10、レビューで発見・修正）。以前は呼び出し元のmaterial.updated_atと突き合わせて
// いたため、(1) S-05は保存直後にmaterial.updated_atだけ即座に進み、15秒間隔のポーリングが
// 追いつくまでの間「自分の保存」が「他の人が更新した」と誤判定される、(2) S-17は保存後に
// material自体を再取得しないため、この誤判定が画面を開き直すまで消えない、という2つの不具合が
// あった。呼び出し元は保存成功時にacknowledgeSave()を呼ぶことで、直後のポーリングが
// 自分自身の保存を「変化あり」と誤検知しないようにする。
// 基準値はマウントのたびに強制的な再取得（mutate()）で得る（下記useEffect参照）。SWRの
// キャッシュがコンポーネントをまたいで共有されるため、単に最初に届いたdataを基準値にすると
// 別画面が残した古いキャッシュ値を基準にしてしまう不具合があったため（2026-09-11）。
export function useMaterialEditPresence(materialId: number | null) {
  const key = materialId !== null ? `/api/materials/${materialId}/presence` : null
  const { data, mutate: mutatePresence } = useSWR<PresenceResponse>(
    key,
    (url: string) => apiFetch<PresenceResponse>(url, { method: 'POST' }),
    { refreshInterval: 15000 },
  )
  const baselineRef = useRef<string | null>(null)
  const [changedSinceLoad, setChangedSinceLoad] = useState(false)

  useEffect(() => {
    // materialが切り替わったら基準値をリセットする（別の教材の値を引きずらないように）。
    baselineRef.current = null
    setChangedSinceLoad(false)
    if (!key) return
    let cancelled = false
    // SWRのキャッシュは同一キー（このURL）についてコンポーネントをまたいで共有されるため、
    // 例えばS-17（ページ編集）で保存した直後にS-05（教材編集）へ「保存して目次へ戻る」で
    // 遷移すると、S-05側のこのフックが最初に受け取るdataはS-17が保存前に取得していた
    // 古いキャッシュ値になり得る（stale-while-revalidateでまず古い値が即座に返る）。この古い値を
    // 基準値にしてしまうと、実際には何も変わっていないのに直後の再ポーリングで
    // 「他の人が更新した」と誤検知してしまう（2026-09-11、「保存して目次へ戻る」を押すと
    // 必ずこの警告が出る不具合の原因）。マウントごとに必ずサーバーへ問い合わせ直し、その
    // 応答（キャッシュ経由ではなく、この呼び出し自身が受け取った値）だけを基準値として使う。
    mutatePresence().then((fresh) => {
      if (!cancelled && fresh) baselineRef.current = fresh.updated_at
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId])

  useEffect(() => {
    if (!data || baselineRef.current === null) return
    if (data.updated_at !== baselineRef.current) {
      setChangedSinceLoad(true)
    }
  }, [data])

  // 保存成功直後に呼び出し元から呼ぶ。今回の保存で進んだupdated_atを基準値として取り込み、
  // 次のポーリングが「自分自身の保存」を誤って「他の人が更新した」と警告しないようにする。
  const acknowledgeSave = (newUpdatedAt: string) => {
    baselineRef.current = newUpdatedAt
    setChangedSinceLoad(false)
  }

  return { others: data?.others ?? [], changedSinceLoad, acknowledgeSave }
}
