import type { CompareMode } from '../../shared/types.ts'

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
  lastCommit: 'Last commit',
}

export const MODE_HINTS: Record<CompareMode, string> = {
  worktree: 'HEAD vs working tree (staged + unstaged)',
  staged: 'HEAD vs index (git diff --cached)',
  unstaged: 'index vs working tree (git diff)',
  lastCommit: 'the most recent commit',
}
