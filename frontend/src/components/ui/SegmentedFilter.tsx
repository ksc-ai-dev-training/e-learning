// 3択程度の絞り込みに使う小さなピル型セグメントコントロール。
// マイ学習の必修教材・任意教材の「未受講／受講済み／すべて」絞り込みで使用。
interface SegmentedFilterOption<T extends string> {
  value: T
  label: string
}

interface SegmentedFilterProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentedFilterOption<T>[]
  ariaLabel: string
}

export default function SegmentedFilter<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: SegmentedFilterProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex gap-0.5 rounded-md border border-slate-300 bg-white p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded px-2 py-1 text-xs font-semibold ${
            value === opt.value ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
