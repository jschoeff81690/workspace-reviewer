/** Wire types shared by the server and the browser client. */

/** Which pair of trees a repo is being diffed across. */
export type CompareMode =
  | 'worktree'
  | 'staged'
  | 'unstaged'
  | 'lastCommit'
  /** One specific commit, given by `ref`. */
  | 'commit'
  /** Every commit on HEAD that is not on the base branch, as one diff. */
  | 'branch'

export const COMPARE_MODES: CompareMode[] = [
  'worktree',
  'staged',
  'unstaged',
  'lastCommit',
  'commit',
  'branch',
]

/** A comparison is a mode plus the refs that mode needs. */
export interface Comparison {
  mode: CompareMode
  /** The commit to show, for `commit` mode. */
  ref?: string
  /** The base to compare against, for `branch` mode; defaults to the repo's base. */
  base?: string
}

export function sameComparison(a: Comparison, b: Comparison): boolean {
  return a.mode === b.mode && (a.ref ?? '') === (b.ref ?? '') && (a.base ?? '') === (b.base ?? '')
}

/** Stable key for caching a comparison's results. */
export function comparisonKey(repo: string, comparison: Comparison): string {
  return `${repo}|${comparison.mode}|${comparison.ref ?? ''}|${comparison.base ?? ''}`
}

/** The branch a repo's work is measured against, and how far it has diverged. */
export interface BaseInfo {
  /** Short ref name, e.g. `origin/main`. */
  ref: string
  /** Resolved commit of `ref`. */
  sha: string
  /** Merge base of `ref` and HEAD - the point the branch diverged. */
  mergeBase: string
  /** Commits on HEAD that are not on `ref`. */
  ahead: number
  /** Commits on `ref` that are not on HEAD. */
  behind: number
  /** How the base was chosen, for the tooltip. */
  source: 'override' | 'upstream' | 'origin-head' | 'candidate'
}

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted'
  | 'unknown'

export interface CommitInfo {
  sha: string
  shortSha: string
  subject: string
  author: string
  date: string
  relativeDate: string
}

/** A commit in the per-repo history list, with its diffstat. */
export interface CommitSummary extends CommitInfo {
  parents: string[]
  filesChanged: number
  additions: number
  deletions: number
  /** True when this commit is not on the base branch. */
  ahead: boolean
}

export interface RepoCommits {
  repo: string
  base: BaseInfo | null
  commits: CommitSummary[]
  /** More history exists beyond `commits`. */
  hasMore: boolean
}

export interface RepoCounts {
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
}

export interface RepoSummary {
  /** Directory name, used as the repo's id in the API. */
  name: string
  /** Absolute path on disk. */
  path: string
  branch: string | null
  detached: boolean
  head: CommitInfo | null
  upstream: string | null
  ahead: number
  behind: number
  counts: RepoCounts
  dirty: boolean
  /** What the UI opens the repo with: worktree when dirty, else the last commit. */
  defaultMode: CompareMode
  availableModes: CompareMode[]
  /** Null when no base branch could be found (no remote, no main/master). */
  base: BaseInfo | null
  error?: string
}

export interface WorkspaceInfo {
  root: string
  repos: RepoSummary[]
  generatedAt: string
  serverId: string
  pollMs: number
}

export interface ChangedFile {
  path: string
  oldPath?: string
  status: FileStatus
  additions: number
  deletions: number
  binary: boolean
  staged: boolean
  unstaged: boolean
  /** An untracked directory that was too large to expand into individual files. */
  collapsedDir?: boolean
  fileCount?: number
}

export interface RepoChanges {
  repo: string
  /** Echo of the comparison that produced these files, refs resolved. */
  comparison: Comparison
  /** Human readable description, e.g. "3 commits vs origin/main". */
  label: string
  files: ChangedFile[]
  /** The commit being shown, for `commit` and `lastCommit`. */
  commit: CommitInfo | null
  /** The commits folded into this diff, for `branch`. */
  commits: CommitSummary[]
  truncated: boolean
}

export type DiffLineType = 'context' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  oldLine: number | null
  newLine: number | null
  content: string
  /** "\ No newline at end of file" applied to this line. */
  noNewline?: boolean
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Trailing section heading git puts after the @@ marker. */
  heading: string
  lines: DiffLine[]
}

export interface FileDiff {
  repo: string
  comparison: Comparison
  path: string
  oldPath?: string
  status: FileStatus
  additions: number
  deletions: number
  binary: boolean
  isNew: boolean
  isDeleted: boolean
  hunks: DiffHunk[]
  /** Shiki language id, or 'text'. */
  language: string
  oldContent: string | null
  newContent: string | null
  /** Set when content was withheld (too large, binary, or missing on one side). */
  contentNote: string | null
  /** Set when the diff itself was cut short. */
  diffNote: string | null
}

export interface ApiError {
  error: string
}
