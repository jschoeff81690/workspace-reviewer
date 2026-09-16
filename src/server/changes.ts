import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ChangedFile, CompareMode, FileStatus, RepoChanges } from '../shared/types.ts'
import { compareNames } from '../shared/sort.ts'
import { git, splitZ } from './git.ts'
import { resolveMode } from './modes.ts'
import { isConflict, readStatus, type RepoStatus, type StatusEntry } from './status.ts'

/** Cap on untracked files expanded out of a single untracked directory. */
const UNTRACKED_DIR_LIMIT = 200
/** Cap on files we read just to count added lines. */
const LINE_COUNT_BUDGET = 400
const LINE_COUNT_MAX_BYTES = 1024 * 1024
const FILE_LIMIT = 5000

const EMPTY_STATUS: RepoStatus = {
  branch: { oid: null, branch: null, detached: false, upstream: null, ahead: 0, behind: 0 },
  entries: [],
  byPath: new Map(),
  untracked: [],
  counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
}

interface NumstatEntry {
  additions: number
  deletions: number
  binary: boolean
  path: string
  oldPath?: string
}

export function parseNumstat(out: string): NumstatEntry[] {
  const tokens = splitZ(out)
  const entries: NumstatEntry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[i])
    if (!match) continue
    const binary = match[1] === '-' || match[2] === '-'
    let filePath = match[3]
    let oldPath: string | undefined
    if (filePath === '') {
      // Rename/copy: the two paths follow as separate NUL-terminated fields.
      oldPath = tokens[++i]
      filePath = tokens[++i] ?? ''
    }
    entries.push({
      additions: binary ? 0 : Number(match[1]),
      deletions: binary ? 0 : Number(match[2]),
      binary,
      path: filePath,
      oldPath,
    })
  }
  return entries
}

export function parseNameStatus(out: string): Map<string, { code: string; oldPath?: string }> {
  const tokens = splitZ(out)
  const map = new Map<string, { code: string; oldPath?: string }>()
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]
    if (!/^[A-Z]\d*$/.test(code)) continue
    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = tokens[++i]
      const newPath = tokens[++i]
      if (newPath !== undefined) map.set(newPath, { code, oldPath })
    } else {
      const filePath = tokens[++i]
      if (filePath !== undefined) map.set(filePath, { code })
    }
  }
  return map
}

export function statusFromCode(code: string | undefined): FileStatus {
  switch (code?.[0]) {
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'M': return 'modified'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'typechange'
    case 'U': return 'conflicted'
    case undefined: return 'modified'
    default: return 'unknown'
  }
}

export async function listChanges(
  repoName: string,
  repoPath: string,
  mode: CompareMode,
): Promise<RepoChanges> {
  const spec = await resolveMode(repoPath, mode)
  // Commit-to-commit comparisons have no index or work tree to consult, so
  // skip the status call entirely there.
  const needsStatus = spec.mode !== 'lastCommit'
  const [numstatRes, nameStatusRes, status] = await Promise.all([
    git(repoPath, [...spec.diffArgs, '--numstat', '-z', '--']),
    git(repoPath, [...spec.diffArgs, '--name-status', '-z', '--']),
    needsStatus ? readStatus(repoPath) : Promise.resolve(EMPTY_STATUS),
  ])

  const numstat = parseNumstat(numstatRes.stdout)
  const nameStatus = parseNameStatus(nameStatusRes.stdout)

  const files: ChangedFile[] = numstat.map((entry) => {
    const meta = nameStatus.get(entry.path)
    const statusEntry = status.byPath.get(entry.path)
    const conflicted = statusEntry ? isConflict(statusEntry) : false
    return {
      path: entry.path,
      oldPath: entry.oldPath ?? meta?.oldPath,
      status: conflicted ? 'conflicted' : statusFromCode(meta?.code),
      additions: entry.additions,
      deletions: entry.deletions,
      binary: entry.binary,
      staged: stagedFlag(mode, statusEntry),
      unstaged: unstagedFlag(mode, statusEntry),
    }
  })

  if (spec.includesUntracked) {
    files.push(...(await expandUntracked(repoPath, status.untracked)))
  }

  files.sort((a, b) => compareNames(a.path, b.path))
  const truncated = files.length > FILE_LIMIT

  return {
    repo: repoName,
    mode: spec.mode,
    label: spec.label,
    files: truncated ? files.slice(0, FILE_LIMIT) : files,
    commit: spec.commit,
    truncated,
  }
}

function stagedFlag(mode: CompareMode, entry: StatusEntry | undefined): boolean {
  if (mode === 'staged') return true
  if (mode === 'lastCommit' || mode === 'unstaged') return false
  return !!entry && entry.x !== ' ' && entry.x !== '?'
}

function unstagedFlag(mode: CompareMode, entry: StatusEntry | undefined): boolean {
  if (mode === 'unstaged') return true
  if (mode === 'lastCommit' || mode === 'staged') return false
  return !!entry && entry.y !== ' ' && entry.y !== '?'
}

/**
 * `git status` collapses a wholly-untracked directory into a single `dir/`
 * entry; expand those into files so they show up as leaves in the tree.
 */
async function expandUntracked(repoPath: string, untracked: StatusEntry[]): Promise<ChangedFile[]> {
  const out: ChangedFile[] = []
  let budget = LINE_COUNT_BUDGET

  const addFile = async (filePath: string): Promise<void> => {
    const abs = path.join(repoPath, filePath)
    let additions = 0
    let binary = false
    try {
      const info = await stat(abs)
      if (!info.isFile()) return
      if (budget > 0 && info.size <= LINE_COUNT_MAX_BYTES) {
        budget--
        const buf = await readFile(abs)
        binary = isBinary(buf)
        if (!binary) additions = countLines(buf.toString('utf8'))
      }
    } catch {
      return
    }
    out.push({
      path: filePath,
      status: 'untracked',
      additions,
      deletions: 0,
      binary,
      staged: false,
      unstaged: true,
    })
  }

  for (const entry of untracked) {
    if (!entry.path.endsWith('/')) {
      await addFile(entry.path)
      continue
    }
    const dir = entry.path.replace(/\/$/, '')
    const res = await git(repoPath, ['ls-files', '--others', '--exclude-standard', '-z', '--', dir])
    const listed = res.code === 0 ? splitZ(res.stdout) : []
    if (listed.length > UNTRACKED_DIR_LIMIT) {
      out.push({
        path: entry.path,
        status: 'untracked',
        additions: 0,
        deletions: 0,
        binary: false,
        staged: false,
        unstaged: true,
        collapsedDir: true,
        fileCount: listed.length,
      })
      continue
    }
    for (const filePath of listed) await addFile(filePath)
  }

  return out
}

export function isBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192)
  for (let i = 0; i < limit; i++) if (buf[i] === 0) return true
  return false
}

export function countLines(text: string): number {
  if (text === '') return 0
  let count = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  if (text.endsWith('\n')) count--
  return count
}
