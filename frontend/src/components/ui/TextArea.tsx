import { forwardRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

// 複数行テキスト入力（詳細設計書2.1.5節）。ネイティブの<textarea>を直接使わずこれを使う。
// forwardRefにしているのはMarkdownHtmlEditorの「画像を挿入」がカーソル位置に文字列を
// 挿入するため、実DOM要素のselectionStart/End・focusにアクセスする必要があるため（2026-09-30）。
const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea(props, ref) {
    const { className = '', ...rest } = props
    return (
      <textarea
        ref={ref}
        className={`rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-700 focus:outline-none ${className}`}
        {...rest}
      />
    )
  },
)

export default TextArea
