import type { BaseInfo } from '../shared/types.ts'
import { git, revParse } from './git.ts'

/** Tried in order when the branch has no upstream and origin/HEAD is missing. */
const CANDIDATES = [
  'origin/main',
  'origin/master',
  'upstream/main',
  'upstream/master',
  'main',
  'master',
  'develop',
]

const cache = new Map<string, BaseInfo | null>()
const CACHE_LIMIT = 256

export interface ResolveBaseInput {
  repoPath: string
  /** Current HEAD commit; the result is cached against it. */
  headSha: string | null
  /** Branch name, so a local base ref is not compared against itself. */
  branch: string | null
  /** Upstream from `git status -b`, when the branch tracks one. */
  upstream: string | null
  /** `--base` from the command line. */
  override?: string
}

/**
 * Work out what "the base branch" means for a repo, so a stack of local commits
 * can be diffed as one change.
 *
 * Preference order: an explicit `--base`, the branch's upstream, `origin/HEAD`
 * (what `origin` calls its default branch), then the usual suspects. The result
 * is cached per HEAD commit, since resolving it costs three git processes and
 * only changes when HEAD or the remote refs move.
 */
export async function resolveBase(input: ResolveBaseInput): Promise<BaseInfo | null> {
  const { repoPath, headSha, branch, upstream, override } = input
  if (!headSha) return null

  const key = `${repoPath}|${override ?? ''}|${upstream ?? ''}|${headSha}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const resolved = await resolveUncached(repoPath, headSha, branch, upstream, override)
  cache.set(key, resolved)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  return resolved
}

async function resolveUncached(
  repoPath: string,
  headSha: string,
  branch: string | null,
  upstream: string | null,
  override?: string,
): Promise<BaseInfo | null> {
  const candidate = await pickCandidate(repoPath, branch, upstream, override)
  if (!candidate) return null

  const sha = await revParse(repoPath, `${candidate.ref}^{commit}`)
  if (!sha) return null

  const [mergeBaseRes, countRes] = await Promise.all([
    git(repoPath, ['merge-base', sha, headSha]),
    git(repoPath, ['rev-list', '--left-right', '--count', `${sha}...${headSha}`]),
  ])
  if (mergeBaseRes.code !== 0) return null
  const mergeBase = mergeBaseRes.stdout.trim()
  if (!mergeBase) return null

  let behind = 0
  let ahead = 0
  if (countRes.code === 0) {
    const [left, right] = countRes.stdout.trim().split(/\s+/).map(Number)
    behind = Number.isFinite(left) ? left : 0
    ahead = Number.isFinite(right) ? right : 0
  }

  return { ref: candidate.ref, sha, mergeBase, ahead, behind, source: candidate.source }
}

async function pickCandidate(
  repoPath: string,
  branch: string | null,
  upstream: string | null,
  override?: string,
): Promise<{ ref: string; source: BaseInfo['source'] } | null> {
  if (override) return { ref: override, source: 'override' }
  if (upstream) return { ref: upstream, source: 'upstream' }

  // What the remote itself calls its default branch.
  const originHead = await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (originHead.code === 0) {
    const ref = originHead.stdout.trim()
    if (ref && ref !== branch) return { ref, source: 'origin-head' }
  }

  // One process for every fallback: ask which of them exist.
  const names = CANDIDATES.map((ref) => (ref.includes('/') ? `refs/remotes/${ref}` : `refs/heads/${ref}`))
  const existing = await git(repoPath, ['for-each-ref', '--format=%(refname)', ...names])
  if (existing.code !== 0) return null
  const found = new Set(existing.stdout.split('\n').map((line) => line.trim()).filter(Boolean))

  for (let i = 0; i < CANDIDATES.length; i++) {
    // Skip the branch we are on: diffing it against itself says nothing.
    if (CANDIDATES[i] === branch) continue
    if (found.has(names[i])) return { ref: CANDIDATES[i], source: 'candidate' }
  }
  return null
}
