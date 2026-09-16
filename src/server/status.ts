import type { RepoCounts } from '../shared/types.ts'
import { git, splitZ } from './git.ts'

export interface StatusEntry {
  /** Index state, normalized to a space for "unmodified" (v2 prints `.`). */
  x: string
  /** Work-tree state, same normalization. */
  y: string
  path: string
  origPath?: string
}

export interface BranchInfo {
  oid: string | null
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
}

export interface RepoStatus {
  branch: BranchInfo
  entries: StatusEntry[]
  byPath: Map<string, StatusEntry>
  untracked: StatusEntry[]
  counts: RepoCounts
}

const UNMODIFIED = '.'

/**
 * Parse `git status --porcelain=v2 -b -z`.
 *
 * v2 is worth the extra parsing over v1: one invocation yields the file list,
 * the branch, its upstream, the ahead/behind counts *and* the HEAD sha, which
 * is otherwise four separate git processes per repo.
 */
export function parsePorcelainV2(out: string): RepoStatus {
  const tokens = splitZ(out)
  const branch: BranchInfo = {
    oid: null,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
  }
  const entries: StatusEntry[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.startsWith('# ')) {
      applyHeader(branch, token.slice(2))
      continue
    }
    switch (token[0]) {
      case '1': {
        const entry = ordinaryEntry(token, 8)
        if (entry) entries.push(entry)
        break
      }
      case '2': {
        const entry = ordinaryEntry(token, 9)
        if (entry) {
          const orig = tokens[++i]
          if (orig !== undefined) entry.origPath = orig
          entries.push(entry)
        }
        break
      }
      case 'u': {
        const entry = ordinaryEntry(token, 10)
        if (entry) entries.push(entry)
        break
      }
      case '?':
        entries.push({ x: '?', y: '?', path: token.slice(2) })
        break
      default:
        // `!` (ignored) and anything unrecognized.
        break
    }
  }

  const byPath = new Map<string, StatusEntry>()
  const untracked: StatusEntry[] = []
  const counts: RepoCounts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  for (const entry of entries) {
    byPath.set(entry.path, entry)
    if (entry.x === '?') {
      counts.untracked++
      untracked.push(entry)
      continue
    }
    if (isConflict(entry)) {
      counts.conflicted++
      continue
    }
    if (entry.x !== ' ') counts.staged++
    if (entry.y !== ' ') counts.unstaged++
  }

  return { branch, entries, byPath, untracked, counts }
}

function applyHeader(branch: BranchInfo, header: string): void {
  const space = header.indexOf(' ')
  if (space < 0) return
  const key = header.slice(0, space)
  const value = header.slice(space + 1)
  switch (key) {
    case 'branch.oid':
      branch.oid = value === '(initial)' ? null : value
      break
    case 'branch.head':
      if (value === '(detached)') branch.detached = true
      else branch.branch = value
      break
    case 'branch.upstream':
      branch.upstream = value
      break
    case 'branch.ab': {
      for (const part of value.split(' ')) {
        const count = Number(part.slice(1))
        if (!Number.isFinite(count)) continue
        if (part.startsWith('+')) branch.ahead = count
        else if (part.startsWith('-')) branch.behind = count
      }
      break
    }
    default:
      break
  }
}

/** Entry layout is fixed-width fields then the path, which may contain spaces. */
function ordinaryEntry(token: string, pathField: number): StatusEntry | null {
  const fields = token.split(' ')
  if (fields.length <= pathField) return null
  const xy = fields[1]
  if (!xy || xy.length < 2) return null
  return {
    x: xy[0] === UNMODIFIED ? ' ' : xy[0],
    y: xy[1] === UNMODIFIED ? ' ' : xy[1],
    path: fields.slice(pathField).join(' '),
  }
}

export function isConflict(entry: StatusEntry): boolean {
  const { x, y } = entry
  if (x === 'U' || y === 'U') return true
  return (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

export async function readStatus(repoPath: string): Promise<RepoStatus> {
  const res = await git(repoPath, ['status', '--porcelain=v2', '-b', '-z'])
  if (res.code !== 0) throw new Error(res.stderr.trim() || 'git status failed')
  return parsePorcelainV2(res.stdout)
}

/** Stable digest of the parts of a status that should trigger a UI refresh. */
export function statusSignature(status: RepoStatus): string {
  let hash = 0x811c9dc5
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  feed(status.branch.oid ?? 'none')
  feed(status.branch.branch ?? 'detached')
  feed(`${status.branch.ahead}/${status.branch.behind}`)
  for (const entry of status.entries) feed(`${entry.x}${entry.y}${entry.path}${entry.origPath ?? ''}`)
  return (hash >>> 0).toString(16)
}
