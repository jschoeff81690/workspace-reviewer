import type { CommitInfo } from '../shared/types.ts'
import { readCommit } from './git.ts'

const CACHE_LIMIT = 256
const cache = new Map<string, CommitInfo | null>()

/**
 * Commit metadata for a sha, cached. A repo's HEAD commit is displayed on every
 * workspace refresh but only changes when someone commits, so this removes one
 * git process per repo from the steady-state path.
 */
export async function commitForSha(repoPath: string, sha: string | null): Promise<CommitInfo | null> {
  if (!sha) return null
  const key = `${repoPath}:${sha}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const commit = await readCommit(repoPath, sha)
  cache.set(key, commit)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  return commit
}
