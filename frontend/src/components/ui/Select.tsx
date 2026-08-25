// 固定選択肢のプルダウン（詳細設計書2.1.5節）。ネイティブの<select>を直接使わずこれを使う。
// ネイティブ<select>と違いonChangeは値そのものを受け取る（イベントではない）。
export interface SelectOption {
  value: string
  label: string
}

export default function Select({
  value,
  onChange,
  options,
  id,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  id?: string
  className?: string
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:border-blue-700 focus:outline-none ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
