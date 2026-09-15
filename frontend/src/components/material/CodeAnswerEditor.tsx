import { useEffect, useRef } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-bash'
import { resolvePrismLanguage } from '../../lib/codeLanguages'

// setRangeTextはブラウザのUndo履歴に乗らない（Ctrl+Zで元に戻らない）ため、Tab/Enterによる
// 挿入にはexecCommandを使う。非推奨APIだが、素のtextareaへの挿入をUndo対応させる標準的な
// 手段として現在も広く使われている。使えない環境ではsetRangeTextにフォールバックする。
function insertText(ta: HTMLTextAreaElement, text: string) {
  const ok = document.execCommand && document.execCommand('insertText', false, text)
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end')
  }
}

// 選択範囲を含む行の範囲（行頭〜行末）を返す。
function lineRangeAround(value: string, start: number, end: number): [number, number] {
  const lineStart = value.lastIndexOf('\n', Math.max(start - 1, 0)) + 1
  let lineEnd = value.indexOf('\n', Math.max(end - 1, 0))
  if (lineEnd === -1) lineEnd = value.length
  return [lineStart, lineEnd]
}

// Tabキーでのインデント。カーソルのみ（選択範囲なし）ならその位置に4スペースを挿入するだけだが、
// 選択範囲がある場合は選択内容を消さず、選択にかかる行それぞれの先頭に4スペースを追加する
// （一般的なコードエディタと同じ挙動。以前はsetRangeTextで選択範囲をまるごと4スペースに
// 置き換えてしまい、選択していたコードが丸ごと消えるバグがあった）。
function indentSelection(ta: HTMLTextAreaElement) {
  const { selectionStart: start, selectionEnd: end, value } = ta
  if (start === end) {
    insertText(ta, '    ')
    return
  }
  const [lineStart, lineEnd] = lineRangeAround(value, start, end)
  const block = value.slice(lineStart, lineEnd)
  const indented = block
    .split('\n')
    .map((line) => '    ' + line)
    .join('\n')
  ta.setSelectionRange(lineStart, lineEnd)
  insertText(ta, indented)
  ta.setSelectionRange(lineStart, lineStart + indented.length)
}

// Shift+Tabでの逆インデント。選択にかかる各行の先頭にある空白（半角スペース最大4つ、またはタブ
// 1つ）を取り除く。以前はShift+Tabもe.key==='Tab'にしか反応しない判定のせいで通常のTabと同じく
// インデントが挿入されてしまうバグがあった（フォーカス移動もインデント解除もされなかった）。
function dedentSelection(ta: HTMLTextAreaElement) {
  const { selectionStart: start, selectionEnd: end, value } = ta
  const [lineStart, lineEnd] = lineRangeAround(value, start, end)
  const block = value.slice(lineStart, lineEnd)
  const dedented = block
    .split('\n')
    .map((line) => line.replace(/^ {1,4}|^\t/, ''))
    .join('\n')
  if (dedented === block) return
  ta.setSelectionRange(lineStart, lineEnd)
  insertText(ta, dedented)
  ta.setSelectionRange(lineStart, lineStart + dedented.length)
}

// コード記述式（S-16）の回答欄。素のtextareaの上にPrism.jsでハイライトした<pre>を重ね、
// 行番号ガターを併設する（react-simple-code-editor等のライブラリは使わず、行番号ガターの
// スクロール同期を自分で制御できるよう自前実装にしている。2026-09-15、モックB案を採用）。
// Tabキーはフォーカス移動ではなくインデント挿入（Shift+Tabは逆インデント）、Enterキーは前の行の
// インデントを引き継ぎ、行末が":"または"{"の場合はさらに1段深くする。IME変換確定中のEnter/Tabは
// 奪わない（2026-09-15、実装レビューで発見した不具合の修正: 選択範囲を伴うTabでコードが消える、
// Ctrl+Zで戻せない、Shift+Tabが逆インデントにならない、IME変換中に改行が誤挿入される、の4点）。
export default function CodeAnswerEditor({
  value,
  onChange,
  disabled,
  language,
  rows = 6,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  language: string | null
  rows?: number
  placeholder?: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const codeRef = useRef<HTMLElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const grammarName = resolvePrismLanguage(language)

  useEffect(() => {
    const codeEl = codeRef.current
    if (!codeEl) return
    const grammar = grammarName ? Prism.languages[grammarName] : undefined
    if (grammar && grammarName) {
      // Prism.highlightElement()は要素のclassName（"language-xxx"）から言語を自動判定するAPIだが、
      // このコンポーネントはコード内容をReactのstateで管理しておりclassNameを付与していないため、
      // 何もハイライトされない（"language-none"扱いになる）バグがあった。言語を直接渡せる
      // Prism.highlight(text, grammar, language)を使うことで、className検出に依存せず確実に
      // 対応言語のグラマーを適用する（2026-09-15、再レビューで発見）。
      codeEl.innerHTML = Prism.highlight(value, grammar, grammarName)
    } else {
      codeEl.textContent = value
    }
  }, [value, grammarName])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME変換確定のEnter（漢字変換を確定するキー操作）まで奪ってしまうと、変換中の文字列の後ろに
    // 改行が挿入されてしまう。isComposing（および一部ブラウザ向けのkeyCode 229判定）の間は
    // 何もせず、ブラウザ・IME側の処理に委ねる。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return

    const ta = e.currentTarget
    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        dedentSelection(ta)
      } else {
        indentSelection(ta)
      }
      onChange(ta.value)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const start = ta.selectionStart
      const before = ta.value.slice(0, start)
      const lineStart = before.lastIndexOf('\n') + 1
      const curLine = before.slice(lineStart)
      const indentMatch = curLine.match(/^[ \t]*/)
      let indent = indentMatch ? indentMatch[0] : ''
      if (/[:{]\s*$/.test(curLine.trimEnd())) indent += '    '
      insertText(ta, '\n' + indent)
      onChange(ta.value)
    }
  }

  function handleScroll() {
    // textareaは末尾が改行のとき、カーソル用の余白を確保するためscrollHeightがpre/gutterより
    // わずかに大きくなることがある。scrollTopをそのままpre/gutterのscrollTopへ代入すると、
    // pre/gutter側の実際の最大scrollTopでクランプされてズレる（行番号ガターと実際のコードの
    // 行が1行分ズレて見えるバグがあった）。scrollTopに依存せず、transformで見た目上の位置だけを
    // ずらすことで、pre/gutter自身の可動域に関係なく常にtextareaと同じ量だけ動かせるようにする。
    const ta = textareaRef.current
    if (!ta) return
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`
    if (preRef.current) preRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`
  }

  const lineCount = value.split('\n').length
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')
  const heightPx = rows * 21 + 16

  return (
    <div
      className={`flex overflow-hidden rounded-md border ${
        disabled ? 'border-slate-200' : 'border-slate-300 focus-within:border-blue-700'
      }`}
      style={{ height: heightPx }}
    >
      <div
        aria-hidden
        className="select-none overflow-hidden whitespace-pre bg-slate-50 text-right font-mono text-[13px] leading-relaxed text-slate-400"
      >
        <div ref={gutterRef} className="px-2 py-2">
          {lineNumbers}
        </div>
      </div>
      <div className="relative flex-1 bg-white">
        {value === '' && placeholder && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap px-3 py-2 font-mono text-[13px] leading-relaxed text-slate-400"
          >
            {placeholder}
          </div>
        )}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <pre ref={preRef} className="m-0 whitespace-pre bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed">
            <code ref={codeRef} />
          </pre>
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          disabled={disabled}
          spellCheck={false}
          className="absolute inset-0 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed text-transparent caret-slate-800 outline-none"
        />
      </div>
    </div>
  )
}
