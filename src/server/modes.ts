import type { CommitInfo, CompareMode } from '../shared/types.ts'
import { EMPTY_TREE, readCommit, revParse } from './git.ts'

/** Where one side of a comparison reads its content from. */
export type Side = { kind: 'ref'; ref: string } | { kind: 'index' } | { kind: 'worktree' }

export interface ModeSpec {
  mode: CompareMode
  label: string
  /** Arguments after `git` that produce the base->target patch. */
  diffArgs: string[]
  oldSide: Side
  newSide: Side
  includesUntracked: boolean
  /** The commit being shown, for `lastCommit`. */
  commit: CommitInfo | null
}

export async function resolveMode(repoPath: string, mode: CompareMode): Promise<ModeSpec> {
  const headSha = await revParse(repoPath, 'HEAD')
  const headShort = headSha ? headSha.slice(0, 8) : 'empty tree'
  const base = headSha ?? EMPTY_TREE

  switch (mode) {
    case 'staged':
      return {
        mode,
        label: `${headShort} → index (staged)`,
        diffArgs: ['diff', '--cached', '-M', base],
        oldSide: { kind: 'ref', ref: base },
        newSide: { kind: 'index' },
        includesUntracked: false,
        commit: null,
      }
    case 'unstaged':
      return {
        mode,
        label: 'index → working tree (unstaged)',
        diffArgs: ['diff', '-M'],
        oldSide: { kind: 'index' },
        newSide: { kind: 'worktree' },
        includesUntracked: true,
        commit: null,
      }
    case 'lastCommit': {
      if (!headSha) {
        return {
          mode,
          label: 'no commits yet',
          diffArgs: ['diff', '-M', EMPTY_TREE, EMPTY_TREE],
          oldSide: { kind: 'ref', ref: EMPTY_TREE },
          newSide: { kind: 'ref', ref: EMPTY_TREE },
          includesUntracked: false,
          commit: null,
        }
      }
      const parent = await revParse(repoPath, 'HEAD^')
      const commit = await readCommit(repoPath, headSha)
      return {
        mode,
        label: parent
          ? `${parent.slice(0, 8)} → ${headShort} (last commit)`
          : `root commit ${headShort}`,
        diffArgs: ['diff', '-M', parent ?? EMPTY_TREE, headSha],
        oldSide: { kind: 'ref', ref: parent ?? EMPTY_TREE },
        newSide: { kind: 'ref', ref: headSha },
        includesUntracked: false,
        commit,
      }
    }
    case 'worktree':
    default:
      return {
        mode: 'worktree',
        label: `${headShort} → working tree (staged + unstaged)`,
        diffArgs: ['diff', '-M', base],
        oldSide: { kind: 'ref', ref: base },
        newSide: { kind: 'worktree' },
        includesUntracked: true,
        commit: null,
      }
  }
}
