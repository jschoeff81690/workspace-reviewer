import { lineTokens, type TokenLines } from '../lib/highlight.ts'
import type { GapRow, Row } from '../lib/rows.ts'
import type { CharRange } from '../lib/wordDiff.ts'
import { CodeText } from './CodeText.tsx'
import { GapBand } from './GapBand.tsx'
import { TruncationRow } from './TruncationRow.tsx'

interface Props {
  rows: Row[]
  wordRanges: Map<string, CharRange[]>
  oldTokens: TokenLines | null
  newTokens: TokenLines | null
  limit: number
  onExpand: (row: GapRow, direction: 'up' | 'down' | 'all') => void
  onRaiseLimit: () => void
}

const MARKERS = { add: '+', del: '-', context: ' ' } as const

/** `git diff` layout: one column of lines, additions and deletions interleaved. */
export function InlineDiff({
  rows,
  wordRanges,
  oldTokens,
  newTokens,
  limit,
  onExpand,
  onRaiseLimit,
}: Props) {
  const visible = rows.slice(0, limit)

  return (
    <table className="diff inline">
      <tbody>
        {visible.map((row) => {
          if (row.kind === 'gap') {
            return <GapBand key={row.key} row={row} colSpan={4} onExpand={onExpand} />
          }
          const { line } = row
          const tokens =
            line.type === 'del'
              ? lineTokens(oldTokens, line.oldLine)
              : lineTokens(newTokens, line.newLine)
          return (
            <tr key={row.key} className={line.type}>
              <td className="num">{line.oldLine ?? ''}</td>
              <td className="num second">{line.newLine ?? ''}</td>
              <td className="marker">{MARKERS[line.type]}</td>
              <td className="content">
                <CodeText
                  content={line.content}
                  tokens={tokens}
                  marks={wordRanges.get(row.key)}
                  markKind={line.type === 'del' ? 'del' : 'add'}
                />
                {line.noNewline && <span className="pill warn"> no newline at end of file</span>}
              </td>
            </tr>
          )
        })}
        {rows.length > limit && (
          <TruncationRow
            colSpan={4}
            hidden={rows.length - limit}
            onRaiseLimit={onRaiseLimit}
          />
        )}
      </tbody>
    </table>
  )
}
