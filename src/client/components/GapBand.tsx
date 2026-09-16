import { EXPAND_STEP, type GapRow } from '../lib/rows.ts'

interface Props {
  row: GapRow
  colSpan: number
  onExpand: (row: GapRow, direction: 'up' | 'down' | 'all') => void
}

/** The collapsed band standing in for unchanged lines between two hunks. */
export function GapBand({ row, colSpan, onExpand }: Props) {
  const { remaining, canExpand, gap } = row
  const small = remaining <= EXPAND_STEP

  return (
    <tr className="gap">
      <td colSpan={colSpan}>
        <div className="gap-inner">
          {canExpand && small && (
            <button className="gap-btn" onClick={() => onExpand(row, 'all')}>
              {`⤳ expand ${remaining} ${remaining === 1 ? 'line' : 'lines'}`}
            </button>
          )}
          {canExpand && !small && (
            <>
              <button
                className="gap-btn"
                title={`Show ${EXPAND_STEP} lines from line ${row.hiddenFrom}`}
                onClick={() => onExpand(row, 'down')}
              >
                {`↓ ${EXPAND_STEP}`}
              </button>
              <button
                className="gap-btn"
                title={`Show ${EXPAND_STEP} lines up to line ${row.hiddenTo}`}
                onClick={() => onExpand(row, 'up')}
              >
                {`↑ ${EXPAND_STEP}`}
              </button>
              <button className="gap-btn" onClick={() => onExpand(row, 'all')}>
                {`expand all ${remaining.toLocaleString()}`}
              </button>
            </>
          )}
          {!canExpand && <span>{`⋯ ${remaining.toLocaleString()} unchanged lines`}</span>}
          {canExpand && (
            <span className="scroll-x-hint">
              {`lines ${row.hiddenFrom.toLocaleString()}–${row.hiddenTo.toLocaleString()}`}
            </span>
          )}
          {gap.heading && <span className="heading">{gap.heading}</span>}
        </div>
      </td>
    </tr>
  )
}
