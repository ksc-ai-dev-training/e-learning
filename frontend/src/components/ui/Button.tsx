import type { ButtonHTMLAttributes } from 'react'

// 全ボタンで共通（詳細設計書2.1.3節）。ネイティブの<button>を直接スタイリングしない。
const VARIANT_CLASSES: Record<string, string> = {
  primary: 'bg-blue-900 text-white hover:bg-blue-800',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
}

export default function Button({ variant = 'primary', className = '', ...rest }: Props) {
  return (
    <button
      type="button"
      className={`h-9 rounded-md px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  )
}
