import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { CompareMode, RepoSummary } from '../shared/types.ts'
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

/**
 * Summarize a repo for the left pane. Pass `status` to reuse the watcher's
 * most recent poll instead of spawning another `git status`.
 */
export async function summarizeRepo(repo: RepoHandle, status?: RepoStatus): Promise<RepoSummary> {
  const base: RepoSummary = {
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
  }

  try {
    const current = status ?? (await readStatus(repo.path))
    const head = await commitForSha(repo.path, current.branch.oid)
    const { counts } = current
    const dirty = counts.staged + counts.unstaged + counts.untracked + counts.conflicted > 0

    const availableModes: CompareMode[] = []
    if (dirty) availableModes.push('worktree')
    if (counts.staged > 0 || counts.conflicted > 0) availableModes.push('staged')
    if (counts.unstaged > 0 || counts.untracked > 0) availableModes.push('unstaged')
    if (head) availableModes.push('lastCommit')

    return {
      ...base,
      branch: current.branch.branch,
      detached: current.branch.detached,
      head,
      upstream: current.branch.upstream,
      ahead: current.branch.ahead,
      behind: current.branch.behind,
      counts,
      dirty,
      defaultMode: dirty ? 'worktree' : 'lastCommit',
      availableModes: availableModes.length ? availableModes : ['lastCommit'],
    }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}
