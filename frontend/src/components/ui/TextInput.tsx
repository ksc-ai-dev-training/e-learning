import type { InputHTMLAttributes } from 'react'

// テキスト入力（詳細設計書2.1.5節）。ネイティブの<input>を直接使わずこれを使う（2.1.5節の実装規約）。
export default function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return (
    <input
      className={`h-9 rounded-md border border-slate-300 px-3 text-sm placeholder:text-slate-400 focus:border-blue-700 focus:outline-none ${className}`}
      {...rest}
    />
  )
}
