import { useState } from 'react'
import type { KeyboardEvent } from 'react'

const MAX_TAGS = 10
const MAX_TAG_LENGTH = 50

// タグの複数入力（詳細設計書2.1.5節）。Enterで確定、×で削除。1タグ50文字以内、最大10個（10.5節）
export default function TagInput({
  id,
  value,
  onChange,
}: {
  id?: string
  value: string[]
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  const addTag = () => {
    const tag = draft.trim().replace(/^#/, '')
    setDraft('')
    if (!tag || tag.length > MAX_TAG_LENGTH || value.includes(tag) || value.length >= MAX_TAGS) {
      return
    }
    onChange([...value, tag])
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  return (
    <div
      id={id}
      className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1.5 focus-within:border-blue-700"
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800"
        >
          #{tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="text-blue-400 hover:text-blue-700"
            title="削除"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={value.length === 0 ? 'タグを入力してEnter' : ''}
        className="min-w-[120px] flex-1 border-none bg-transparent text-sm outline-none placeholder:text-slate-400"
      />
    </div>
  )
}
