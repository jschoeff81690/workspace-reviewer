import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { languageForPath } from '../shared/languages.ts'
import { parseDiff, wholeFileHunk, type ParsedFileDiff } from '../shared/parse-diff.ts'
import type { CompareMode, DiffHunk, FileDiff, FileStatus } from '../shared/types.ts'
import { git, gitBuffer } from './git.ts'
import { resolveMode, type Side } from './modes.ts'
import { countLines, isBinary } from './changes.ts'
import { isConflict, readStatus } from './status.ts'

/** Content beyond these limits is not sent; the diff hunks still are. */
const MAX_CONTENT_BYTES = 4 * 1024 * 1024
const MAX_CONTENT_LINES = 40_000
/** Rendering budget: hunk lines past this are dropped with a note. */
const MAX_DIFF_LINES = 30_000

export interface FileDiffRequest {
  repoName: string
  repoPath: string
  mode: CompareMode
  filePath: string
  oldPath?: string
}

export async function getFileDiff(req: FileDiffRequest): Promise<FileDiff> {
  const { repoName, repoPath, mode, filePath } = req
  const spec = await resolveMode(repoPath, mode)
  // Only the working-tree and index modes need to know about untracked files
  // and conflicts; a commit diff does not.
  const status = spec.mode === 'lastCommit' ? null : await readStatus(repoPath)
  const entry = status?.byPath.get(filePath)
  const untracked =
    spec.includesUntracked &&
    !!status &&
    isUntracked(filePath, status.untracked.map((candidate) => candidate.path))

  const language = languageForPath(filePath)
  const result: FileDiff = {
    repo: repoName,
    mode: spec.mode,
    path: filePath,
    oldPath: req.oldPath,
    status: 'modified',
    additions: 0,
    deletions: 0,
    binary: false,
    isNew: false,
    isDeleted: false,
    hunks: [],
    language,
    oldContent: null,
    newContent: null,
    contentNote: null,
    diffNote: null,
  }

  if (untracked) {
    return await untrackedDiff(result, repoPath, filePath)
  }

  const pathspec = req.oldPath && req.oldPath !== filePath ? [req.oldPath, filePath] : [filePath]
  const patch = await git(repoPath, [...spec.diffArgs, '-M', '--', ...pathspec])
  const parsed = pickFile(parseDiff(patch.stdout), filePath, req.oldPath)

  if (parsed) {
    result.hunks = parsed.hunks
    result.binary = parsed.binary
    result.isNew = parsed.isNew
    result.deletions = parsed.deletions
    result.additions = parsed.additions
    result.isDeleted = parsed.isDeleted
    if (parsed.isRename && parsed.oldPath && parsed.oldPath !== filePath) result.oldPath = parsed.oldPath
  }
  result.status = deriveStatus(result, entry ? isConflict(entry) : false, parsed)

  const trimmed = trimHunks(result.hunks)
  result.hunks = trimmed.hunks
  result.diffNote = trimmed.note

  if (!result.binary) {
    const oldPath = result.oldPath ?? filePath
    const [oldSide, newSide] = await Promise.all([
      result.isNew ? emptySide() : readSide(repoPath, spec.oldSide, oldPath),
      result.isDeleted ? emptySide() : readSide(repoPath, spec.newSide, filePath),
    ])
    result.oldContent = oldSide.text
    result.newContent = newSide.text
    const notes = [oldSide.note ? `old: ${oldSide.note}` : null, newSide.note ? `new: ${newSide.note}` : null]
    result.contentNote = notes.filter(Boolean).join(' · ') || null
    if (oldSide.binary || newSide.binary) result.binary = true
  }

  return result
}

function deriveStatus(
  result: FileDiff,
  conflicted: boolean,
  parsed: ParsedFileDiff | null,
): FileStatus {
  if (conflicted) return 'conflicted'
  if (result.isNew) return 'added'
  if (result.isDeleted) return 'deleted'
  if (parsed?.isRename) return 'renamed'
  return 'modified'
}

async function untrackedDiff(result: FileDiff, repoPath: string, filePath: string): Promise<FileDiff> {
  result.status = 'untracked'
  result.isNew = true
  const side = await readSide(repoPath, { kind: 'worktree' }, filePath)
  if (side.binary) {
    result.binary = true
    return result
  }
  if (side.text === null) {
    result.contentNote = side.note ?? 'file could not be read'
    return result
  }
  const hunk = wholeFileHunk(side.text)
  result.hunks = hunk ? [hunk] : []
  result.additions = hunk ? hunk.lines.length : 0
  result.newContent = side.text
  const trimmed = trimHunks(result.hunks)
  result.hunks = trimmed.hunks
  result.diffNote = trimmed.note
  return result
}

function pickFile(files: ParsedFileDiff[], filePath: string, oldPath?: string): ParsedFileDiff | null {
  if (files.length === 0) return null
  const exact = files.find((f) => f.newPath === filePath || (f.newPath === null && f.oldPath === filePath))
  if (exact) return exact
  if (oldPath) {
    const byOld = files.find((f) => f.oldPath === oldPath)
    if (byOld) return byOld
  }
  return files[0]
}

function trimHunks(hunks: DiffHunk[]): { hunks: DiffHunk[]; note: string | null } {
  let total = 0
  for (const hunk of hunks) total += hunk.lines.length
  if (total <= MAX_DIFF_LINES) return { hunks, note: null }

  const kept: DiffHunk[] = []
  let used = 0
  for (const hunk of hunks) {
    if (used + hunk.lines.length > MAX_DIFF_LINES) break
    kept.push(hunk)
    used += hunk.lines.length
  }
  return {
    hunks: kept,
    note: `Diff truncated: showing ${used.toLocaleString()} of ${total.toLocaleString()} changed lines across ${kept.length} of ${hunks.length} hunks.`,
  }
}

interface SideContent {
  text: string | null
  binary: boolean
  note: string | null
}

function emptySide(): Promise<SideContent> {
  return Promise.resolve({ text: null, binary: false, note: null })
}

/** Read one side's full file content, for split view, file view and context expansion. */
export async function readSide(repoPath: string, side: Side, filePath: string): Promise<SideContent> {
  let buf: Buffer | null = null

  if (side.kind === 'worktree') {
    try {
      buf = await readFile(path.join(repoPath, filePath))
    } catch {
      return { text: null, binary: false, note: 'not present in the working tree' }
    }
  } else {
    const spec = side.kind === 'index' ? `:${filePath}` : `${side.ref}:${filePath}`
    let res = await gitBuffer(repoPath, ['cat-file', 'blob', spec])
    if (res.code !== 0 && side.kind === 'index') {
      // Conflicted paths have no stage 0; fall back to "ours".
      res = await gitBuffer(repoPath, ['cat-file', 'blob', `:2:${filePath}`])
    }
    if (res.code !== 0) {
      return { text: null, binary: false, note: side.kind === 'index' ? 'not in the index' : 'not in that commit' }
    }
    buf = res.stdout
  }

  if (isBinary(buf)) return { text: null, binary: true, note: null }
  if (buf.length > MAX_CONTENT_BYTES) {
    return { text: null, binary: false, note: `file is ${(buf.length / 1024 / 1024).toFixed(1)} MB, too large to load` }
  }
  const text = buf.toString('utf8')
  const lines = countLines(text)
  if (lines > MAX_CONTENT_LINES) {
    return { text: null, binary: false, note: `${lines.toLocaleString()} lines, too large to load` }
  }
  return { text, binary: false, note: null }
}

/** A path is untracked when it, or a containing directory, is listed as untracked. */
function isUntracked(filePath: string, untrackedPaths: string[]): boolean {
  for (const candidate of untrackedPaths) {
    if (candidate === filePath) return true
    if (candidate.endsWith('/') && filePath.startsWith(candidate)) return true
  }
  return false
}
