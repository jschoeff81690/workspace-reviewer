import { diffWordsWithSpace } from 'diff'

export type CharRange = [start: number, end: number]

/** Lines longer than this are not word-diffed; the payoff is not worth the cost. */
const MAX_LINE = 2000
/** If more than this share of a line changed, word marks are noise. */
const MAX_CHANGED_SHARE = 0.75

export interface WordDiffResult {
  left: CharRange[]
  right: CharRange[]
}

/**
 * Character ranges that actually differ between a removed line and the added
 * line replacing it, so the UI can mark the edit inside the line.
 */
export function wordDiff(oldText: string, newText: string): WordDiffResult | null {
  if (oldText === newText) return null
  if (oldText.length > MAX_LINE || newText.length > MAX_LINE) return null
  if (oldText.trim() === '' || newText.trim() === '') return null

  const parts = diffWordsWithSpace(oldText, newText)
  const left: CharRange[] = []
  const right: CharRange[] = []
  let leftPos = 0
  let rightPos = 0
  let leftChanged = 0
  let rightChanged = 0

  for (const part of parts) {
    const length = part.value.length
    if (part.added) {
      push(right, rightPos, rightPos + length)
      rightChanged += length
      rightPos += length
    } else if (part.removed) {
      push(left, leftPos, leftPos + length)
      leftChanged += length
      leftPos += length
    } else {
      leftPos += length
      rightPos += length
    }
  }

  const share = Math.max(
    oldText.length ? leftChanged / oldText.length : 0,
    newText.length ? rightChanged / newText.length : 0,
  )
  if (share > MAX_CHANGED_SHARE) return null
  if (left.length === 0 && right.length === 0) return null
  return { left, right }
}

/** Append, merging with the previous range when they touch. */
function push(ranges: CharRange[], start: number, end: number): void {
  const last = ranges[ranges.length - 1]
  if (last && last[1] === start) last[1] = end
  else ranges.push([start, end])
}
