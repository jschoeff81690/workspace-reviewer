import { useMemo } from 'react'
import type {
  ChangedFile,
  Comparison,
  RepoChanges,
  RepoCommits,
  RepoSummary,
} from '../../shared/types.ts'
import { comparisonKey } from '../../shared/types.ts'
import { buildTree } from '../lib/tree.ts'
import {
  CHIP_MODES,
  MODE_HINTS,
  MODE_LABELS,
  UNCOMMITTED_MODES,
  type Selection,
} from '../lib/uiTypes.ts'
import { CommitList } from './CommitList.tsx'
import { FileTreeView } from './FileTreeView.tsx'

interface Props {
  repos: RepoSummary[]
  changes: Record<string, RepoChanges | undefined>
  changesError: Record<string, string | undefined>
  expanded: Set<string>
  collapsedDirs: Set<string>
  selection: Selection | null
  filter: string
  comparisonFor: (repo: RepoSummary) => Comparison
  commits: Record<string, RepoCommits | undefined>
  commitsCollapsed: Set<string>
  onFilter: (value: string) => void
  onToggleRepo: (name: string) => void
  onSetComparison: (repo: string, comparison: Comparison) => void
  onSelect: (repo: string, file: ChangedFile) => void
  onToggleDir: (key: string) => void
  onToggleCommits: (repo: string) => void
  onShowMoreCommits: (repo: string) => void
  filterRef: React.RefObject<HTMLInputElement | null>
}

export function Sidebar(props: Props) {
  const { repos, filter, expanded } = props
  const needle = filter.trim().toLowerCase()

  const visibleRepos = useMemo(() => {
    if (!needle) return repos
    return repos.filter((repo) => {
      if (repo.name.toLowerCase().includes(needle)) return true
      const changes = props.changes[comparisonKey(repo.name, props.comparisonFor(repo))]
      return !!changes?.files.some((file) => file.path.toLowerCase().includes(needle))
    })
  }, [repos, needle, props.changes, props.comparisonFor])

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <input
          ref={props.filterRef}
          className="filter"
          placeholder="Filter repos and files ( / )"
          value={filter}
          spellCheck={false}
          onChange={(event) => props.onFilter(event.target.value)}
        />
      </div>

      <div className="repo-list">
        {visibleRepos.map((repo) => {
          const comparison = props.comparisonFor(repo)
          const key = comparisonKey(repo.name, comparison)
          const isOpen = expanded.has(repo.name)
          const changes = props.changes[key]
          const error = props.changesError[key]
          const repoMatches = needle !== '' && repo.name.toLowerCase().includes(needle)
          const files = filterFiles(changes?.files, needle, repoMatches)

          return (
            <section key={repo.name} className={isOpen ? 'repo open' : 'repo'}>
              <button className="repo-head" onClick={() => props.onToggleRepo(repo.name)}>
                <span className={isOpen ? 'chev open' : 'chev'}>{'▶'}</span>
                <span className="repo-name">{repo.name}</span>
                <span className="state">
                  <StateDot repo={repo} />
                  <span className="counts" title={countsTitle(repo)}>
                    {countsLabel(repo)}
                  </span>
                </span>
                <span className="repo-sub">
                  <span className="branch" title={branchTitle(repo)}>
                    {repo.branch ?? `detached @ ${repo.head?.shortSha ?? '?'}`}
                  </span>
                  {(repo.ahead > 0 || repo.behind > 0) && (
                    <span className="counts" title={`${repo.ahead} ahead, ${repo.behind} behind ${repo.upstream ?? 'upstream'}`}>
                      {repo.ahead > 0 ? `↑${repo.ahead}` : ''}
                      {repo.behind > 0 ? `↓${repo.behind}` : ''}
                    </span>
                  )}
                  <span className="subject">
                    {repo.error ?? (repo.dirty ? '' : (repo.head?.subject ?? 'no commits yet'))}
                  </span>
                </span>
              </button>

              {isOpen && (
                <>
                  <div className="mode-bar">
                    {CHIP_MODES.filter((candidate) => repo.availableModes.includes(candidate)).map(
                      (candidate, index, shown) => (
                        <ModeChip
                          key={candidate}
                          mode={candidate}
                          active={comparison.mode === candidate}
                          count={candidate === 'branch' ? repo.base?.ahead : undefined}
                          // Separate the uncommitted comparisons from the committed ones.
                          divider={
                            index > 0 &&
                            UNCOMMITTED_MODES.includes(shown[index - 1]) &&
                            !UNCOMMITTED_MODES.includes(candidate)
                          }
                          onClick={() =>
                            props.onSetComparison(
                              repo.name,
                              candidate === 'branch' ? { mode: 'branch' } : { mode: candidate },
                            )
                          }
                        />
                      ),
                    )}
                  </div>

                  {repo.head && (
                    <CommitList
                      commits={props.commits[repo.name]?.commits}
                      base={repo.base}
                      hasMore={props.commits[repo.name]?.hasMore ?? false}
                      comparison={comparison}
                      headSha={repo.head.sha}
                      collapsed={props.commitsCollapsed.has(repo.name)}
                      loading={!props.commits[repo.name]}
                      onToggle={() => props.onToggleCommits(repo.name)}
                      onSelectCommit={(sha) =>
                        props.onSetComparison(repo.name, { mode: 'commit', ref: sha })
                      }
                      onSelectBranch={() => props.onSetComparison(repo.name, { mode: 'branch' })}
                      onShowMore={() => props.onShowMoreCommits(repo.name)}
                    />
                  )}

                  {error && <div className="empty-note">{error}</div>}

                  {!error && !changes && <div className="empty-note">loading…</div>}

                  {!error && changes && files.length === 0 && (
                    <div className="empty-note">
                      {needle ? 'no files match the filter' : 'no changed files in this comparison'}
                    </div>
                  )}

                  {!error && changes && files.length > 0 && (
                    <>
                      <div className="files-head" title={changes.commit?.date}>
                        <span className="files-label">{changes.label}</span>
                        <span className="files-count">
                          {files.length} {files.length === 1 ? 'file' : 'files'}
                        </span>
                      </div>
                      <FileTreeView
                        nodes={buildTree(files)}
                        repo={repo.name}
                        depth={0}
                        selectedPath={props.selection?.repo === repo.name ? props.selection.path : null}
                        collapsed={props.collapsedDirs}
                        onToggleDir={props.onToggleDir}
                        onSelect={(file) => props.onSelect(repo.name, file)}
                      />
                      {changes.truncated && (
                        <div className="empty-note">
                          list truncated — too many changed files to show
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          )
        })}

        {visibleRepos.length === 0 && <div className="empty-note">no repos match the filter</div>}
      </div>
    </aside>
  )
}

function ModeChip({
  mode,
  active,
  count,
  divider,
  onClick,
}: {
  mode: Comparison['mode']
  active: boolean
  count?: number
  divider: boolean
  onClick: () => void
}) {
  return (
    <>
      {divider && <span className="chip-divider" />}
      <button
        className="chip"
        aria-pressed={active}
        title={`Compare ${MODE_HINTS[mode]}`}
        onClick={onClick}
      >
        {MODE_LABELS[mode]}
        {count !== undefined && count > 0 && <span className="chip-count">{count}</span>}
      </button>
    </>
  )
}

function filterFiles(
  files: ChangedFile[] | undefined,
  needle: string,
  repoMatches: boolean,
): ChangedFile[] {
  if (!files) return []
  if (!needle || repoMatches) return files
  return files.filter((file) => file.path.toLowerCase().includes(needle))
}

function StateDot({ repo }: { repo: RepoSummary }) {
  const kind = repo.error
    ? 'error'
    : repo.counts.conflicted > 0
      ? 'conflict'
      : repo.counts.unstaged > 0 || repo.counts.untracked > 0
        ? 'dirty'
        : repo.counts.staged > 0
          ? 'staged'
          : 'clean'
  return <i className={`state-dot ${kind}`} title={countsTitle(repo)} />
}

function countsLabel(repo: RepoSummary): string {
  if (repo.error) return 'error'
  const { staged, unstaged, untracked, conflicted } = repo.counts
  if (staged + unstaged + untracked + conflicted === 0) return ''
  return [
    conflicted ? `${conflicted}!` : '',
    staged ? `${staged}s` : '',
    unstaged ? `${unstaged}u` : '',
    untracked ? `${untracked}?` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function countsTitle(repo: RepoSummary): string {
  if (repo.error) return repo.error
  const { staged, unstaged, untracked, conflicted } = repo.counts
  if (staged + unstaged + untracked + conflicted === 0) return 'clean working tree'
  return [
    conflicted ? `${conflicted} conflicted` : '',
    staged ? `${staged} staged` : '',
    unstaged ? `${unstaged} unstaged` : '',
    untracked ? `${untracked} untracked` : '',
  ]
    .filter(Boolean)
    .join(', ')
}

function branchTitle(repo: RepoSummary): string {
  const head = repo.head ? `${repo.head.shortSha} ${repo.head.subject}` : 'no commits'
  const upstream = repo.upstream ? `\ntracking ${repo.upstream}` : ''
  return `${repo.path}\n${head}${upstream}`
}
