interface Props {
  colSpan: number
  hidden: number
  onRaiseLimit: () => void
}

/** Very large diffs render in chunks so the first paint stays fast. */
export function TruncationRow({ colSpan, hidden, onRaiseLimit }: Props) {
  return (
    <tr className="gap">
      <td colSpan={colSpan}>
        <div className="gap-inner">
          <button className="gap-btn" onClick={onRaiseLimit}>
            {`render ${hidden.toLocaleString()} more ${hidden === 1 ? 'row' : 'rows'}`}
          </button>
          <span className="scroll-x-hint">held back to keep rendering responsive</span>
        </div>
      </td>
    </tr>
  )
}
