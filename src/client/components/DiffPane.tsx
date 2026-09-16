import { useMemo, useState } from 'react'
import type { Comparison, FileDiff, RepoChanges } from '../../shared/types.ts'
import type { ThemeName } from '../lib/highlight.ts'
import {
  buildRows,
  expandGap,
  pairRows,
  splitLines,
  type ExpandState,
  type GapRow,
} from '../lib/rows.ts'
import { useTokens } from '../lib/useTokens.ts'
import { MODE_LABELS, VIEW_LABELS, type ViewMode } from '../lib/uiTypes.ts'
import { FileView } from './FileView.tsx'
import { InlineDiff } from './InlineDiff.tsx'
import { SplitDiff } from './SplitDiff.tsx'

/** Rows rendered before the "render more" break. */
const INITIAL_LIMIT = 2000
const LIMIT_STEP = 5000

interface Props {
  file: FileDiff | null
  comparison: Comparison
  /** The comparison's file list, for its label and commit context. */
  changes: RepoChanges | undefined
  loading: boolean
  error: string | null
  view: ViewMode
  wrap: boolean
  theme: ThemeName
  onView: (view: ViewMode) => void
  onWrap: (wrap: boolean) => void
  onNav: (delta: number) => void
  navCount: number
  navIndex: number
}

export function DiffPane(props: Props) {
  const { file, comparison, changes, loading, error, view, wrap, theme, onView, onWrap, onNav } =
    props
  const [expand, setExpand] = useState<ExpandState>({})
  const [limit, setLimit] = useState(INITIAL_LIMIT)

  const newLines = useMemo(() => splitLines(file?.newContent ?? null), [file?.newContent])
  const oldLines = useMemo(() => splitLines(file?.oldContent ?? null), [file?.oldContent])

  const rows = useMemo(
    () => (file ? buildRows({ hunks: file.hunks, expand, newLines }) : []),
    [file, expand, newLines],
  )
  const paired = useMemo(() => pairRows(rows), [rows])

  const changedLines = useMemo(() => {
    const set = new Set<number>()
    for (const hunk of file?.hunks ?? []) {
      for (const line of hunk.lines) if (line.type === 'add' && line.newLine) set.add(line.newLine)
    }
    return set
  }, [file])

  const language = file?.language ?? 'text'
  const showingOld = view === 'file' && file?.newContent === null && file?.oldContent !== null
  const oldTokenState = useTokens(file?.oldContent ?? null, language, theme)
  const newTokenState = useTokens(file?.newContent ?? null, language, theme)
  const highlighting = oldTokenState.pending || newTokenState.pending

  const onExpand = (row: GapRow, direction: 'up' | 'down' | 'all'): void => {
    setExpand((state) => expandGap(state, row, direction))
  }
  const raiseLimit = (): void => setLimit((value) => value + LIMIT_STEP)

  return (
    <div className="main">
      <header className="file-head">
        {file ? (
          <>
            <div className="file-title">
              <span className="repo-tag">{file.repo}</span>
              <PathLabel path={file.path} oldPath={file.oldPath} />
            </div>
            <div className="file-meta">
              <span className="pill">{file.status}</span>
              <span className="stat">
                <span className="plus">+{file.additions}</span>{' '}
                <span className="minus">-{file.deletions}</span>
              </span>
              <ComparisonPill comparison={comparison} changes={changes} />
              <span className="pill">{language}</span>
              {file.contentNote && <span className="pill warn">{file.contentNote}</span>}
              {highlighting && <span className="pill">highlighting…</span>}
            </div>
          </>
        ) : (
          <div className="file-title">
            <span className="dir">no file selected</span>
          </div>
        )}

        <div className="spacer" style={{ flex: 1 }} />

        <div className="file-meta">
          {props.navCount > 0 && (
            <span className="scroll-x-hint">
              {props.navIndex + 1}/{props.navCount}
            </span>
          )}
          <button className="btn icon" title="Previous file (k)" onClick={() => onNav(-1)}>
            {'↑'}
          </button>
          <button className="btn icon" title="Next file (j)" onClick={() => onNav(1)}>
            {'↓'}
          </button>
          <div className="segmented" role="group" aria-label="View mode">
            {(Object.keys(VIEW_LABELS) as ViewMode[]).map((candidate, index) => (
              <button
                key={candidate}
                aria-pressed={view === candidate}
                title={`${VIEW_LABELS[candidate]} view (${index + 1})`}
                onClick={() => onView(candidate)}
              >
                {VIEW_LABELS[candidate]}
              </button>
            ))}
          </div>
          <button
            className="btn"
            aria-pressed={wrap}
            title="Wrap long lines (w)"
            onClick={() => onWrap(!wrap)}
          >
            {wrap ? 'wrap on' : 'wrap off'}
          </button>
        </div>
      </header>

      <div className={wrap ? 'diff-scroll wrap' : 'diff-scroll'}>
        {error && <div className="error-box">{error}</div>}

        {!error && !file && loading && (
          <div className="center-note">
            <div className="spinner" />
          </div>
        )}

        {!error && !file && !loading && <Welcome />}

        {!error && file && file.binary && (
          <div className="center-note">
            <strong>Binary file</strong>
            <span>
              {file.additions === 0 && file.deletions === 0
                ? 'No textual diff is available.'
                : `${file.additions} additions, ${file.deletions} deletions`}
            </span>
          </div>
        )}

        {!error && file && !file.binary && view === 'inline' && (
          <InlineDiff
            rows={rows}
            wordRanges={paired.wordRanges}
            oldTokens={oldTokenState.tokens}
            newTokens={newTokenState.tokens}
            limit={limit}
            onExpand={onExpand}
            onRaiseLimit={raiseLimit}
          />
        )}

        {!error && file && !file.binary && view === 'split' && (
          <SplitDiff
            rows={paired.splitRows}
            wordRanges={paired.wordRanges}
            oldTokens={oldTokenState.tokens}
            newTokens={newTokenState.tokens}
            limit={limit}
            onExpand={onExpand}
            onRaiseLimit={raiseLimit}
            wrap={wrap}
          />
        )}

        {!error && file && !file.binary && view === 'file' && (
          <FileContents
            lines={showingOld ? (oldLines ?? []) : (newLines ?? [])}
            tokens={showingOld ? oldTokenState.tokens : newTokenState.tokens}
            available={(showingOld ? oldLines : newLines) !== null}
            changedLines={showingOld ? new Set<number>() : changedLines}
            limit={limit}
            onRaiseLimit={raiseLimit}
            note={file.contentNote}
            showingOld={showingOld}
          />
        )}

        {!error && file && !file.binary && file.hunks.length === 0 && view !== 'file' && (
          <div className="center-note">
            <strong>No textual changes</strong>
            <span>
              {file.status === 'renamed'
                ? 'The file was renamed with identical content.'
                : 'Only file metadata (mode or type) changed.'}
            </span>
          </div>
        )}

        {file?.diffNote && <div className="diff-note">{file.diffNote}</div>}
      </div>
    </div>
  )
}

function FileContents({
  lines,
  tokens,
  available,
  changedLines,
  limit,
  onRaiseLimit,
  note,
  showingOld,
}: {
  lines: string[]
  tokens: ReturnType<typeof useTokens>['tokens']
  available: boolean
  changedLines: Set<number>
  limit: number
  onRaiseLimit: () => void
  note: string | null
  showingOld: boolean
}) {
  if (!available) {
    return (
      <div className="center-note">
        <strong>File contents unavailable</strong>
        <span>{note ?? 'This side of the comparison has no file.'}</span>
      </div>
    )
  }
  return (
    <>
      {showingOld && (
        <div className="diff-note">
          Showing the file as it was before deletion — it is not present on the new side.
        </div>
      )}
      <FileView
        lines={lines}
        tokens={tokens}
        changedLines={changedLines}
        limit={limit}
        onRaiseLimit={onRaiseLimit}
      />
    </>
  )
}

/**
 * Says which comparison the diff belongs to: the commit and its subject, how
 * many commits a branch diff folds together, or the plain mode name.
 */
function ComparisonPill({
  comparison,
  changes,
}: {
  comparison: Comparison
  changes: RepoChanges | undefined
}) {
  const label = MODE_LABELS[comparison.mode]

  if (comparison.mode === 'branch') {
    const count = changes?.commits.length ?? 0
    return (
      <span className="pill accent" title={changes?.label}>
        {count > 0
          ? `${count} ${count === 1 ? 'commit' : 'commits'} vs ${comparison.base ?? 'base'}`
          : (changes?.label ?? label)}
      </span>
    )
  }

  if (comparison.mode === 'commit' || comparison.mode === 'lastCommit') {
    const commit = changes?.commit
    if (!commit) return <span className="pill">{label}</span>
    return (
      <span
        className="pill accent"
        title={`${commit.sha}\n${commit.author} \u00b7 ${new Date(commit.date).toLocaleString()}\n${commit.subject}`}
      >
        {`${commit.shortSha.slice(0, 8)} \u00b7 ${commit.subject}`}
      </span>
    )
  }

  return <span className="pill">{label}</span>
}

function PathLabel({ path, oldPath }: { path: string; oldPath?: string }) {
  const cut = path.lastIndexOf('/')
  const dir = cut >= 0 ? path.slice(0, cut + 1) : ''
  const base = cut >= 0 ? path.slice(cut + 1) : path
  return (
    <>
      {oldPath && oldPath !== path && <span className="dir">{`${oldPath} → `}</span>}
      {dir && <span className="dir">{dir}</span>}
      <span className="base">{base}</span>
    </>
  )
}

function Welcome() {
  return (
    <div className="center-note">
      <strong>Pick a repo on the left</strong>
      <span>
        Repos with a filled dot have staged or unstaged changes. Clean repos show their most recent
        commit.
      </span>
      <div className="shortcuts">
        <kbd>j</kbd>
        <span>next file</span>
        <kbd>k</kbd>
        <span>previous file</span>
        <kbd>1</kbd>
        <span>inline diff</span>
        <kbd>2</kbd>
        <span>split diff</span>
        <kbd>3</kbd>
        <span>whole file</span>
        <kbd>w</kbd>
        <span>toggle line wrapping</span>
        <kbd>/</kbd>
        <span>filter files</span>
        <kbd>r</kbd>
        <span>refresh now</span>
      </div>
    </div>
  )
}
