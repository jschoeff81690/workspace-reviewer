import type { CompareMode, Comparison } from '../../shared/types.ts'

export type ViewMode = 'inline' | 'split' | 'file'

export interface Selection {
  repo: string
  path: string
  oldPath?: string
}

export const VIEW_LABELS: Record<ViewMode, string> = {
  inline: 'Inline',
  split: 'Split',
  file: 'File',
}

export const MODE_LABELS: Record<CompareMode, string> = {
  worktree: 'Working tree',
  staged: 'Staged',
  unstaged: 'Unstaged',
  branch: 'Branch',
  lastCommit: 'Last commit',
  commit: 'Commit',
}

export const MODE_HINTS: Record<CompareMode, string> = {
  worktree: 'HEAD vs working tree (staged + unstaged)',
  staged: 'HEAD vs index (git diff --cached)',
  unstaged: 'index vs working tree (git diff)',
  branch: 'every commit on this branch as one diff, against its base',
  lastCommit: 'the most recent commit',
  commit: 'a single commit',
}

/**
 * Modes offered as chips, in display order. `commit` is missing on purpose:
 * it is chosen from the commit list, which supplies the ref.
 */
export const CHIP_MODES: CompareMode[] = ['worktree', 'staged', 'unstaged', 'branch', 'lastCommit']

/** Uncommitted modes are grouped apart from the committed ones. */
export const UNCOMMITTED_MODES: CompareMode[] = ['worktree', 'staged', 'unstaged']

export const DEFAULT_COMPARISON: Comparison = { mode: 'worktree' }
