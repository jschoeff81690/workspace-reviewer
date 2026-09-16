import type { ThemedToken } from 'shiki'
import type { CharRange } from '../lib/wordDiff.ts'

interface Segment {
  text: string
  token?: ThemedToken
  marked: boolean
}

interface Props {
  content: string
  tokens?: ThemedToken[]
  marks?: CharRange[]
  /** Which colour the intra-line marks use. */
  markKind?: 'add' | 'del'
}

/**
 * One line of code: Shiki tokens where available, with the changed words inside
 * the line marked. Tokens come from whole-file tokenization, so multi-line
 * constructs stay correctly coloured.
 */
export function CodeText({ content, tokens, marks, markKind }: Props) {
  if (content === '') return '​'
  const segments = toSegments(content, tokens, marks)

  return (
    <>
      {segments.map((segment, index) => {
        const styled = segment.token ? (
          <span key={index} style={tokenStyle(segment.token)}>
            {segment.text}
          </span>
        ) : (
          segment.text
        )
        if (!segment.marked) return <span key={index}>{styled}</span>
        return (
          <mark key={index} className={markKind === 'del' ? 'w del' : 'w'}>
            {styled}
          </mark>
        )
      })}
    </>
  )
}

/** Shiki's FontStyle bit flags. */
const ITALIC = 1
const BOLD = 2
const UNDERLINE = 4
const STRIKE = 8

function tokenStyle(token: ThemedToken): React.CSSProperties {
  const style: React.CSSProperties = { color: token.color }
  const font = token.fontStyle ?? 0
  if (font > 0) {
    if (font & ITALIC) style.fontStyle = 'italic'
    if (font & BOLD) style.fontWeight = 'bold'
    const decorations = [font & UNDERLINE ? 'underline' : '', font & STRIKE ? 'line-through' : '']
      .filter(Boolean)
      .join(' ')
    if (decorations) style.textDecoration = decorations
  }
  return style
}

/** Split tokens at word-mark boundaries so both can be applied at once. */
function toSegments(content: string, tokens?: ThemedToken[], marks?: CharRange[]): Segment[] {
  const base: { text: string; token?: ThemedToken }[] = []
  if (tokens && tokens.length > 0) {
    let covered = 0
    for (const token of tokens) covered += token.content.length
    // Guard against token/content drift (CRLF, stale tokens mid-refresh).
    if (covered === content.length) {
      for (const token of tokens) base.push({ text: token.content, token })
    }
  }
  if (base.length === 0) base.push({ text: content })
  if (!marks || marks.length === 0) return base.map((piece) => ({ ...piece, marked: false }))

  const segments: Segment[] = []
  let offset = 0
  for (const piece of base) {
    let cursor = 0
    while (cursor < piece.text.length) {
      const absolute = offset + cursor
      const inside = marks.find(([start, end]) => absolute >= start && absolute < end)
      let stop: number
      if (inside) {
        stop = Math.min(piece.text.length, inside[1] - offset)
      } else {
        const next = marks.find(([start]) => start > absolute)
        stop = next ? Math.min(piece.text.length, next[0] - offset) : piece.text.length
      }
      if (stop <= cursor) stop = piece.text.length
      segments.push({ text: piece.text.slice(cursor, stop), token: piece.token, marked: !!inside })
      cursor = stop
    }
    offset += piece.text.length
  }
  return segments
}
