import type { BaseInfo, CommitInfo, Comparison } from '../shared/types.ts'
import { EMPTY_TREE, git, readCommit, resolveCommitish, revParse } from './git.ts'

/** Where one side of a comparison reads its content from. */
export type Side = { kind: 'ref'; ref: string } | { kind: 'index' } | { kind: 'worktree' }

export interface ModeSpec {
  /** The requested comparison with its refs resolved to shas. */
  comparison: Comparison
  label: string
  /** Arguments after `git` that produce the base->target patch. */
  diffArgs: string[]
  oldSide: Side
  newSide: Side
  includesUntracked: boolean
  /** The commit being shown, for `commit` and `lastCommit`. */
  commit: CommitInfo | null
  /** For `branch`: the range whose commits make up this diff. */
  range: { fromSha: string; toSha: string; baseRef: string; ahead: number } | null
}

export class ComparisonError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const short = (sha: string): string => sha.slice(0, 8)

export interface ResolveModeInput {
  repoPath: string
  comparison: Comparison
  /** Resolved base branch, required for `branch` mode. */
  base: BaseInfo | null
}

export async function resolveMode({ repoPath, comparison, base }: ResolveModeInput): Promise<ModeSpec> {
  const headSha = await revParse(repoPath, 'HEAD')
  const headShort = headSha ? short(headSha) : 'empty tree'
  const fallbackBase = headSha ?? EMPTY_TREE

  switch (comparison.mode) {
    case 'staged':
      return {
        comparison: { mode: 'staged' },
        label: `${headShort} → index (staged)`,
        diffArgs: ['diff', '--cached', '-M', fallbackBase],
        oldSide: { kind: 'ref', ref: fallbackBase },
        newSide: { kind: 'index' },
        includesUntracked: false,
        commit: null,
        range: null,
      }

    case 'unstaged':
      return {
        comparison: { mode: 'unstaged' },
        label: 'index → working tree (unstaged)',
        diffArgs: ['diff', '-M'],
        oldSide: { kind: 'index' },
        newSide: { kind: 'worktree' },
        includesUntracked: true,
        commit: null,
        range: null,
      }

    case 'lastCommit': {
      if (!headSha) return emptyRepoSpec('lastCommit')
      return await commitSpec(repoPath, headSha, 'lastCommit')
    }

    case 'commit': {
      if (!comparison.ref) throw new ComparisonError('commit mode needs a ref')
      const sha = await resolveCommitish(repoPath, comparison.ref)
      if (!sha) throw new ComparisonError(`no such commit: ${comparison.ref}`, 404)
      return await commitSpec(repoPath, sha, 'commit')
    }

    case 'branch': {
      if (!headSha) return emptyRepoSpec('branch')
      const resolved = await resolveBranchBase(repoPath, comparison.base, base)
      const ahead = resolved.mergeBase === headSha ? 0 : resolved.ahead
      return {
        comparison: { mode: 'branch', base: resolved.ref },
        label:
          ahead === 0
            ? `no commits ahead of ${resolved.ref}`
            : `${resolved.ref} → HEAD (${ahead} ${ahead === 1 ? 'commit' : 'commits'})`,
        // Diff from the merge base, which is what `base...HEAD` means: the
        // branch's own work, without changes the base picked up since.
        diffArgs: ['diff', '-M', resolved.mergeBase, headSha],
        oldSide: { kind: 'ref', ref: resolved.mergeBase },
        newSide: { kind: 'ref', ref: headSha },
        includesUntracked: false,
        commit: null,
        range: {
          fromSha: resolved.mergeBase,
          toSha: headSha,
          baseRef: resolved.ref,
          ahead,
        },
      }
    }

    case 'worktree':
    default:
      return {
        comparison: { mode: 'worktree' },
        label: `${headShort} → working tree (staged + unstaged)`,
        diffArgs: ['diff', '-M', fallbackBase],
        oldSide: { kind: 'ref', ref: fallbackBase },
        newSide: { kind: 'worktree' },
        includesUntracked: true,
        commit: null,
        range: null,
      }
  }
}

/** A single commit against its first parent. */
async function commitSpec(
  repoPath: string,
  sha: string,
  mode: 'commit' | 'lastCommit',
): Promise<ModeSpec> {
  const parent = await revParse(repoPath, `${sha}^`)
  const commit = await readCommit(repoPath, sha)
  const oldRef = parent ?? EMPTY_TREE
  const isMerge = !!parent && (await isMergeCommit(repoPath, sha))
  return {
    comparison: mode === 'commit' ? { mode, ref: sha } : { mode },
    label: parent
      ? `${short(parent)} → ${short(sha)}${isMerge ? ' (merge, vs first parent)' : ''}`
      : `root commit ${short(sha)}`,
    diffArgs: ['diff', '-M', oldRef, sha],
    oldSide: { kind: 'ref', ref: oldRef },
    newSide: { kind: 'ref', ref: sha },
    includesUntracked: false,
    commit,
    range: null,
  }
}

async function isMergeCommit(repoPath: string, sha: string): Promise<boolean> {
  return (await revParse(repoPath, `${sha}^2`)) !== null
}

async function resolveBranchBase(
  repoPath: string,
  requested: string | undefined,
  fallback: BaseInfo | null,
): Promise<BaseInfo> {
  if (!requested) {
    if (!fallback) {
      throw new ComparisonError(
        'no base branch found for this repo - pass --base, or use a commit comparison',
        409,
      )
    }
    return fallback
  }
  if (fallback && fallback.ref === requested) return fallback

  const sha = await resolveCommitish(repoPath, requested)
  if (!sha) throw new ComparisonError(`no such base: ${requested}`, 404)
  const headSha = await revParse(repoPath, 'HEAD')
  if (!headSha) throw new ComparisonError('repository has no commits', 409)
  const [mergeBaseRes, countRes] = await Promise.all([
    git(repoPath, ['merge-base', sha, headSha]),
    git(repoPath, ['rev-list', '--left-right', '--count', `${sha}...${headSha}`]),
  ])
  if (mergeBaseRes.code !== 0) throw new ComparisonError(`${requested} has no common history with HEAD`, 409)
  const [behind, ahead] = countRes.stdout.trim().split(/\s+/).map(Number)
  return {
    ref: requested,
    sha,
    mergeBase: mergeBaseRes.stdout.trim(),
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
    source: 'override',
  }
}

function emptyRepoSpec(mode: 'lastCommit' | 'branch'): ModeSpec {
  return {
    comparison: { mode },
    label: 'no commits yet',
    diffArgs: ['diff', '-M', EMPTY_TREE, EMPTY_TREE],
    oldSide: { kind: 'ref', ref: EMPTY_TREE },
    newSide: { kind: 'ref', ref: EMPTY_TREE },
    includesUntracked: false,
    commit: null,
    range: null,
  }
}
