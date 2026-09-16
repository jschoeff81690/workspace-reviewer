import { lineTokens, type TokenLines } from '../lib/highlight.ts'
import { CodeText } from './CodeText.tsx'
import { TruncationRow } from './TruncationRow.tsx'

interface Props {
  lines: string[]
  tokens: TokenLines | null
  /** Line numbers touched by the diff, marked in the gutter. */
  changedLines: Set<number>
  limit: number
  onRaiseLimit: () => void
}

/** The file exactly as it stands, highlighted, with changed lines flagged. */
export function FileView({ lines, tokens, changedLines, limit, onRaiseLimit }: Props) {
  const visible = lines.slice(0, limit)

  return (
    <table className="diff file">
      <tbody>
        {visible.map((content, index) => {
          const lineNumber = index + 1
          return (
            <tr
              key={lineNumber}
              className={changedLines.has(lineNumber) ? 'changed-marker' : undefined}
            >
              <td className="num">{lineNumber}</td>
              <td className="content">
                <CodeText content={content} tokens={lineTokens(tokens, lineNumber)} />
              </td>
            </tr>
          )
        })}
        {lines.length > limit && (
          <TruncationRow colSpan={2} hidden={lines.length - limit} onRaiseLimit={onRaiseLimit} />
        )}
      </tbody>
    </table>
  )
}
