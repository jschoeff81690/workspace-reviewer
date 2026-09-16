import { lineTokens, type TokenLines } from '../lib/highlight.ts'
import type { GapRow, LineRow, SplitRow } from '../lib/rows.ts'
import type { CharRange } from '../lib/wordDiff.ts'
import { CodeText } from './CodeText.tsx'
import { GapBand } from './GapBand.tsx'
import { TruncationRow } from './TruncationRow.tsx'

interface Props {
  rows: SplitRow[]
  wordRanges: Map<string, CharRange[]>
  oldTokens: TokenLines | null
  newTokens: TokenLines | null
  limit: number
  onExpand: (row: GapRow, direction: 'up' | 'down' | 'all') => void
  onRaiseLimit: () => void
  wrap: boolean
}

/** Old on the left, new on the right, changed lines paired up and highlighted. */
export function SplitDiff({
  rows,
  wordRanges,
  oldTokens,
  newTokens,
  limit,
  onExpand,
  onRaiseLimit,
  wrap,
}: Props) {
  const visible = rows.slice(0, limit)

  return (
    <table className={wrap ? 'diff split fixed' : 'diff split'}>
      <colgroup>
        <col className="num-col" />
        <col className="code-col" />
        <col className="num-col" />
        <col className="code-col" />
      </colgroup>
      <tbody>
        {visible.map((row) => {
          if (row.kind === 'gap') {
            return <GapBand key={row.key} row={row} colSpan={4} onExpand={onExpand} />
          }
          const leftClass = sideClass(row.left, 'del')
          const rightClass = sideClass(row.right, 'add')
          return (
            <tr key={row.key}>
              <td className={`num ${leftClass}`}>{row.left?.line.oldLine ?? ''}</td>
              <td className={`content ${leftClass}`}>
                <Side
                  row={row.left}
                  tokens={oldTokens}
                  pick={(line) => line.oldLine}
                  wordRanges={wordRanges}
                  markKind="del"
                />
              </td>
              <td className={`num right ${rightClass}`}>{row.right?.line.newLine ?? ''}</td>
              <td className={`content ${rightClass}`}>
                <Side
                  row={row.right}
                  tokens={newTokens}
                  pick={(line) => line.newLine}
                  wordRanges={wordRanges}
                  markKind="add"
                />
              </td>
            </tr>
          )
        })}
        {rows.length > limit && (
          <TruncationRow colSpan={4} hidden={rows.length - limit} onRaiseLimit={onRaiseLimit} />
        )}
      </tbody>
    </table>
  )
}

/** A missing side renders as a dimmed filler cell so the halves stay aligned. */
function sideClass(row: LineRow | null, changed: 'add' | 'del'): string {
  if (!row) return 'empty'
  return row.line.type === 'context' ? 'ctx' : changed
}

function Side({
  row,
  tokens,
  pick,
  wordRanges,
  markKind,
}: {
  row: LineRow | null
  tokens: TokenLines | null
  pick: (line: LineRow['line']) => number | null
  wordRanges: Map<string, CharRange[]>
  markKind: 'add' | 'del'
}) {
  if (!row) return null
  return (
    <>
      <CodeText
        content={row.line.content}
        tokens={lineTokens(tokens, pick(row.line))}
        marks={wordRanges.get(row.key)}
        markKind={markKind}
      />
      {row.line.noNewline && <span className="pill warn"> no newline at end of file</span>}
    </>
  )
}
