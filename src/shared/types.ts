/** Wire types shared by the server and the browser client. */

/** Which pair of trees a repo is being diffed across. */
export type CompareMode = 'worktree' | 'staged' | 'unstaged' | 'lastCommit'

export const COMPARE_MODES: CompareMode[] = ['worktree', 'staged', 'unstaged', 'lastCommit']

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
  mode: CompareMode
  /** Human readable description of the comparison, e.g. "HEAD -> working tree". */
  label: string
  files: ChangedFile[]
  commit: CommitInfo | null
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
  mode: CompareMode
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
