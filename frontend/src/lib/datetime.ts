// APIのタイムスタンプ（TIMESTAMPTZ＝UTCのISO 8601文字列）を日本時間（JST, UTC+9）の
// 表示用文字列に変換する。サーバーはUTCのまま返すため、画面表示側で必ずJSTへ変換すること
// （文字列を単純にslice()すると表示がUTCのままずれるので使わない）。

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function partsToMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return map
}

// "YYYY-MM-DD"（JST）
export function formatDateJst(iso: string): string {
  const p = partsToMap(dateFormatter.formatToParts(new Date(iso)))
  return `${p.year}-${p.month}-${p.day}`
}

// "YYYY-MM-DD HH:mm"（JST）
export function formatDateTimeJst(iso: string): string {
  const p = partsToMap(dateTimeFormatter.formatToParts(new Date(iso)))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

// "YYYY-MM"（JST）。更新月・対象年月の絞り込みのグルーピングに使う
export function formatYearMonthJst(iso: string): string {
  return formatDateJst(iso).slice(0, 7)
}
