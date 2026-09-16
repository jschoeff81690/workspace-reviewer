import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { CompareMode, RepoSummary } from '../shared/types.ts'
import { resolveBase } from './base.ts'
import { commitForSha } from './commits.ts'
import { readStatus, type RepoStatus } from './status.ts'

const SKIP_DIRS = new Set(['node_modules', 'vendor', 'target', 'dist', 'build', '.git'])

export interface RepoHandle {
  name: string
  path: string
}

export interface DiscoverOptions {
  root: string
  depth: number
}

/** Find git work trees at or below `root`, up to `depth` levels down. */
export async function discoverRepos({ root, depth }: DiscoverOptions): Promise<string[]> {
  const found: string[] = []
  const visit = async (dir: string, level: number): Promise<void> => {
    if (await isWorkTree(dir)) {
      found.push(dir)
      return
    }
    if (level >= depth) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const children = entries
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
      .map((e) => path.join(dir, e.name))
      .sort()
    for (const child of children) {
      try {
        if (!(await stat(child)).isDirectory()) continue
      } catch {
        continue
      }
      await visit(child, level + 1)
    }
  }
  await visit(root, 0)
  return found
}

async function isWorkTree(dir: string): Promise<boolean> {
  try {
    // `.git` is a directory for normal clones, a file for worktrees/submodules.
    await stat(path.join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

export interface SummarizeOptions {
  /** Reuse the watcher's most recent poll instead of spawning another git status. */
  status?: RepoStatus
  /** `--base` override from the command line. */
  baseOverride?: string
}

/** Summarize a repo for the left pane: branch, divergence, counts and base. */
export async function summarizeRepo(
  repo: RepoHandle,
  options: SummarizeOptions = {},
): Promise<RepoSummary> {
  const empty: RepoSummary = {
    name: repo.name,
    path: repo.path,
    branch: null,
    detached: false,
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    dirty: false,
    defaultMode: 'lastCommit',
    availableModes: ['lastCommit'],
    base: null,
  }

  try {
    const status = options.status ?? (await readStatus(repo.path))
    const [head, baseInfo] = await Promise.all([
      commitForSha(repo.path, status.branch.oid),
      resolveBase({
        repoPath: repo.path,
        headSha: status.branch.oid,
        branch: status.branch.branch,
        upstream: status.branch.upstream,
        override: options.baseOverride,
      }),
    ])
    const { counts } = status
    const dirty = counts.staged + counts.unstaged + counts.untracked + counts.conflicted > 0

    const availableModes: CompareMode[] = []
    if (dirty) availableModes.push('worktree')
    if (counts.staged > 0 || counts.conflicted > 0) availableModes.push('staged')
    if (counts.unstaged > 0 || counts.untracked > 0) availableModes.push('unstaged')
    if (baseInfo && baseInfo.ahead > 0) availableModes.push('branch')
    if (head) {
      availableModes.push('lastCommit')
      // Picked from the commit list rather than a chip, but still valid.
      availableModes.push('commit')
    }

    return {
      ...empty,
      branch: status.branch.branch,
      detached: status.branch.detached,
      head,
      upstream: status.branch.upstream,
      ahead: status.branch.ahead,
      behind: status.branch.behind,
      counts,
      dirty,
      base: baseInfo,
      defaultMode: dirty ? 'worktree' : 'lastCommit',
      availableModes: availableModes.length ? availableModes : ['lastCommit'],
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  }
}
