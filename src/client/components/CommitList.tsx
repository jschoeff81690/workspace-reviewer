import type { BaseInfo, CommitSummary, Comparison } from '../../shared/types.ts'

interface Props {
  commits: CommitSummary[] | undefined
  base: BaseInfo | null
  hasMore: boolean
  comparison: Comparison
  headSha: string | null
  collapsed: boolean
  loading: boolean
  onToggle: () => void
  onSelectCommit: (sha: string) => void
  onSelectBranch: () => void
  onShowMore: () => void
}

/**
 * Per-repo history. Commits ahead of the base branch are the branch's own work,
 * so they are marked and can be reviewed together (the header) or one at a
 * time (the rows).
 */
export function CommitList(props: Props) {
  const { commits, base, comparison, headSha, collapsed, loading } = props
  const aheadCount = base?.ahead ?? 0

  return (
    <div className="commits">
      <button className="commits-head" onClick={props.onToggle}>
        <span className={collapsed ? 'chev' : 'chev open'}>{'▶'}</span>
        <span className="commits-title">Commits</span>
        {base ? (
          <span className="commits-sub" title={`base: ${base.ref} (${base.source})`}>
            {aheadCount > 0
              ? `${aheadCount} ahead of ${base.ref}`
              : `up to date with ${base.ref}`}
            {base.behind > 0 ? `, ${base.behind} behind` : ''}
          </span>
        ) : (
          <span className="commits-sub">no base branch found</span>
        )}
      </button>

      {!collapsed && (
        <>
          {aheadCount > 0 && (
            <button
              className={comparison.mode === 'branch' ? 'commit-row branch selected' : 'commit-row branch'}
              onClick={props.onSelectBranch}
              title={`All ${aheadCount} commits as one diff against ${base?.ref}`}
            >
              <span className="commit-mark">{'∑'}</span>
              <span className="commit-subject">
                {`All ${aheadCount} ${aheadCount === 1 ? 'commit' : 'commits'} as one diff`}
              </span>
              <span className="commit-when">{base?.ref}</span>
            </button>
          )}

          {loading && !commits && <div className="empty-note">loading commits…</div>}

          {commits?.map((commit) => {
            const selected =
              (comparison.mode === 'commit' && comparison.ref === commit.sha) ||
              (comparison.mode === 'lastCommit' && commit.sha === headSha)
            const included = comparison.mode === 'branch' && commit.ahead
            const classes = [
              'commit-row',
              commit.ahead ? 'ahead' : 'behind-base',
              selected ? 'selected' : '',
              included ? 'included' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={commit.sha}
                className={classes}
                onClick={() => props.onSelectCommit(commit.sha)}
                title={`${commit.sha}\n${commit.author} · ${new Date(commit.date).toLocaleString()}\n${commit.subject}`}
              >
                <span className="commit-mark">{commit.ahead ? '●' : '○'}</span>
                <span className="commit-sha">{commit.shortSha.slice(0, 7)}</span>
                <span className="commit-subject">
                  {commit.parents.length > 1 && <span className="pill">merge</span>}
                  {commit.subject}
                </span>
                <span className="stat">
                  <span className="plus">+{commit.additions}</span>{' '}
                  <span className="minus">-{commit.deletions}</span>
                </span>
                <span className="commit-when">{shortWhen(commit.relativeDate)}</span>
              </button>
            )
          })}

          {props.hasMore && (
            <button className="commits-more" onClick={props.onShowMore}>
              show older commits
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** "63 minutes ago" -> "63m", so the column stays narrow. */
function shortWhen(relative: string): string {
  const match = /^(\d+)\s+(\w)/.exec(relative)
  if (!match) return relative.replace(' ago', '')
  return `${match[1]}${match[2]}`
}
