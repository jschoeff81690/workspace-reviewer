import type { DiffHunk, DiffLine } from '../../shared/types.ts'
import { wordDiff, type CharRange } from './wordDiff.ts'

/** How many lines one click of an expander reveals. */
export const EXPAND_STEP = 20

export interface GapInfo {
  index: number
  /** Inclusive new-file line range of the whole gap. */
  newFrom: number
  newTo: number
  /** oldLine = newLine + offset inside the gap. */
  offset: number
  size: number
  /** Section heading of the hunk that follows, if any. */
  heading: string
}

export interface LineRow {
  kind: 'line'
  key: string
  line: DiffLine
}

export interface GapRow {
  kind: 'gap'
  key: string
  gap: GapInfo
  /** Lines still hidden in this gap. */
  remaining: number
  /** Hidden range bounds, for the expand controls. */
  hiddenFrom: number
  hiddenTo: number
  canExpand: boolean
}

export type Row = LineRow | GapRow

/** Per-gap reveal counts: lines shown from the top and bottom of the gap. */
export type ExpandState = Record<number, { top: number; bottom: number }>

export interface BuildRowsInput {
  hunks: DiffHunk[]
  expand: ExpandState
  /** New-side file split into lines, when available; enables context expansion. */
  newLines: string[] | null
}

function hunkEnds(hunk: DiffHunk): { oldEnd: number; newEnd: number } {
  return {
    oldEnd: hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart + hunk.oldLines - 1,
    newEnd: hunk.newLines === 0 ? hunk.newStart : hunk.newStart + hunk.newLines - 1,
  }
}

/**
 * Flatten hunks into a render list, inserting collapsible bands for the
 * unchanged regions between them. Both diff views consume this list.
 */
export function buildRows({ hunks, expand, newLines }: BuildRowsInput): Row[] {
  const rows: Row[] = []
  let prevOldEnd = 0
  let prevNewEnd = 0
  let lineSeq = 0

  const pushLine = (line: DiffLine): void => {
    rows.push({ kind: 'line', key: `l${lineSeq++}`, line })
  }

  const pushContextRange = (from: number, to: number, offset: number): void => {
    if (!newLines) return
    for (let newLine = from; newLine <= to; newLine++) {
      const content = newLines[newLine - 1]
      if (content === undefined) continue
      pushLine({ type: 'context', oldLine: newLine + offset, newLine, content })
    }
  }

  const pushGap = (index: number, newFrom: number, newTo: number, offset: number, heading: string): void => {
    const size = newTo - newFrom + 1
    if (size <= 0) return
    const state = expand[index] ?? { top: 0, bottom: 0 }
    const top = Math.min(state.top, size)
    const bottom = Math.min(state.bottom, size - top)
    const remaining = size - top - bottom
    const gap: GapInfo = { index, newFrom, newTo, offset, size, heading }

    if (top > 0) pushContextRange(newFrom, newFrom + top - 1, offset)
    if (remaining > 0) {
      rows.push({
        kind: 'gap',
        key: `g${index}`,
        gap,
        remaining,
        hiddenFrom: newFrom + top,
        hiddenTo: newTo - bottom,
        canExpand: newLines !== null,
      })
    }
    if (bottom > 0) pushContextRange(newTo - bottom + 1, newTo, offset)
  }

  hunks.forEach((hunk, index) => {
    pushGap(index, prevNewEnd + 1, hunk.newStart - 1, prevOldEnd - prevNewEnd, hunk.heading)
    for (const line of hunk.lines) pushLine(line)
    const ends = hunkEnds(hunk)
    prevOldEnd = ends.oldEnd
    prevNewEnd = ends.newEnd
  })

  if (newLines && hunks.length > 0) {
    pushGap(hunks.length, prevNewEnd + 1, newLines.length, prevOldEnd - prevNewEnd, '')
  }

  return rows
}

export interface SplitPair {
  kind: 'pair'
  key: string
  left: LineRow | null
  right: LineRow | null
}

export type SplitRow = SplitPair | GapRow

export interface PairedRows {
  splitRows: SplitRow[]
  /** Intra-line marks, keyed by line row key. */
  wordRanges: Map<string, CharRange[]>
}

/**
 * Pair removed lines with the added lines that replaced them, so split view can
 * show them side by side and both views can mark the changed words.
 */
export function pairRows(rows: Row[]): PairedRows {
  const splitRows: SplitRow[] = []
  const wordRanges = new Map<string, CharRange[]>()
  let dels: LineRow[] = []
  let adds: LineRow[] = []
  let pairSeq = 0

  const flush = (): void => {
    const count = Math.max(dels.length, adds.length)
    for (let i = 0; i < count; i++) {
      const left = dels[i] ?? null
      const right = adds[i] ?? null
      splitRows.push({ kind: 'pair', key: `p${pairSeq++}`, left, right })
      if (left && right) {
        const marks = wordDiff(left.line.content, right.line.content)
        if (marks) {
          wordRanges.set(left.key, marks.left)
          wordRanges.set(right.key, marks.right)
        }
      }
    }
    dels = []
    adds = []
  }

  for (const row of rows) {
    if (row.kind === 'gap') {
      flush()
      splitRows.push(row)
      continue
    }
    if (row.line.type === 'del') {
      dels.push(row)
      continue
    }
    if (row.line.type === 'add') {
      adds.push(row)
      continue
    }
    flush()
    splitRows.push({ kind: 'pair', key: `p${pairSeq++}`, left: row, right: row })
  }
  flush()

  return { splitRows, wordRanges }
}

export function splitLines(content: string | null): string[] | null {
  if (content === null) return null
  const body = content.endsWith('\n') ? content.slice(0, -1) : content
  return body === '' ? [] : body.split('\n')
}

/** Reveal `EXPAND_STEP` more lines at one end of a gap, or all of it. */
export function expandGap(
  state: ExpandState,
  gap: GapRow,
  direction: 'up' | 'down' | 'all',
): ExpandState {
  const current = state[gap.gap.index] ?? { top: 0, bottom: 0 }
  if (direction === 'all') {
    return { ...state, [gap.gap.index]: { top: gap.gap.size, bottom: 0 } }
  }
  // "up" reveals the lines just above the following hunk, i.e. the gap's bottom.
  const next =
    direction === 'up'
      ? { ...current, bottom: Math.min(current.bottom + EXPAND_STEP, gap.gap.size - current.top) }
      : { ...current, top: Math.min(current.top + EXPAND_STEP, gap.gap.size - current.bottom) }
  return { ...state, [gap.gap.index]: next }
}
