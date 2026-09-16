import { useMemo } from 'react'
import type { ChangedFile, CompareMode, RepoChanges, RepoSummary } from '../../shared/types.ts'
import { buildTree } from '../lib/tree.ts'
import { MODE_HINTS, MODE_LABELS, type Selection } from '../lib/uiTypes.ts'
import { FileTreeView } from './FileTreeView.tsx'

interface Props {
  repos: RepoSummary[]
  changes: Record<string, RepoChanges | undefined>
  changesError: Record<string, string | undefined>
  expanded: Set<string>
  collapsedDirs: Set<string>
  selection: Selection | null
  filter: string
  modeFor: (repo: RepoSummary) => CompareMode
  onFilter: (value: string) => void
  onToggleRepo: (name: string) => void
  onSetMode: (repo: string, mode: CompareMode) => void
  onSelect: (repo: string, file: ChangedFile) => void
  onToggleDir: (key: string) => void
  filterRef: React.RefObject<HTMLInputElement | null>
}

export function Sidebar(props: Props) {
  const { repos, filter, expanded } = props
  const needle = filter.trim().toLowerCase()

  const visibleRepos = useMemo(() => {
    if (!needle) return repos
    return repos.filter((repo) => {
      if (repo.name.toLowerCase().includes(needle)) return true
      const changes = props.changes[`${repo.name}|${props.modeFor(repo)}`]
      return !!changes?.files.some((file) => file.path.toLowerCase().includes(needle))
    })
  }, [repos, needle, props.changes, props.modeFor])

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
          const mode = props.modeFor(repo)
          const key = `${repo.name}|${mode}`
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
                    {repo.availableModes.map((candidate) => (
                      <button
                        key={candidate}
                        className="chip"
                        aria-pressed={mode === candidate}
                        title={`Compare ${MODE_HINTS[candidate]}`}
                        onClick={() => props.onSetMode(repo.name, candidate)}
                      >
                        {MODE_LABELS[candidate]}
                      </button>
                    ))}
                  </div>

                  {error && <div className="empty-note">{error}</div>}

                  {!error && !changes && <div className="empty-note">loading…</div>}

                  {!error && changes && files.length === 0 && (
                    <div className="empty-note">
                      {needle ? 'no files match the filter' : 'no changed files in this comparison'}
                    </div>
                  )}

                  {!error && changes && files.length > 0 && (
                    <>
                      {mode === 'lastCommit' && changes.commit && (
                        <div className="empty-note" title={changes.commit.date}>
                          {`${changes.commit.shortSha} · ${changes.commit.subject}`}
                        </div>
                      )}
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
