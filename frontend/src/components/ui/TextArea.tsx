import type { TextareaHTMLAttributes } from 'react'

// 複数行テキスト入力（詳細設計書2.1.5節）。ネイティブの<textarea>を直接使わずこれを使う。
export default function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return (
    <textarea
      className={`rounded-md border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-700 focus:outline-none ${className}`}
      {...rest}
    />
  )
}
