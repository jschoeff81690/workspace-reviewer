import type { DiffHunk, DiffLine } from './types.ts'

export interface ParsedFileDiff {
  oldPath: string | null
  newPath: string | null
  hunks: DiffHunk[]
  binary: boolean
  isNew: boolean
  isDeleted: boolean
  isRename: boolean
  additions: number
  deletions: number
}

const HUNK_RE = /^@@+ (?:-(\d+)(?:,(\d+))? )\+(\d+)(?:,(\d+))? @@+ ?(.*)$/

/**
 * Parse `git diff` output. Handles multiple files per patch, renames, binary
 * markers and the "\ No newline at end of file" trailer.
 *
 * Combined diffs (`@@@`, from merge conflicts) carry one column per parent;
 * those are reported as binary-less files with no hunks rather than being
 * mis-parsed, since the two-column line model below cannot represent them.
 */
export function parseDiff(patch: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = []
  const lines = patch.split('\n')
  let file: ParsedFileDiff | null = null
  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let combined = false

  const startFile = (): ParsedFileDiff => {
    const next: ParsedFileDiff = {
      oldPath: null,
      newPath: null,
      hunks: [],
      binary: false,
      isNew: false,
      isDeleted: false,
      isRename: false,
      additions: 0,
      deletions: 0,
    }
    files.push(next)
    return next
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      file = startFile()
      hunk = null
      combined = !line.startsWith('diff --git ')
      const paths = parseDiffGitHeader(line)
      if (paths) {
        file.oldPath = paths[0]
        file.newPath = paths[1]
      }
      continue
    }

    if (!file) {
      // A diff without a `diff --git` header (e.g. `git diff --no-index` output
      // still has one, but hand-made patches may not).
      if (line.startsWith('--- ') || line.startsWith('@@')) {
        file = startFile()
        hunk = null
        combined = false
      } else {
        continue
      }
    }

    if (line.startsWith('old mode ') || line.startsWith('new mode ')) continue
    if (line.startsWith('new file mode')) {
      file.isNew = true
      continue
    }
    if (line.startsWith('deleted file mode')) {
      file.isDeleted = true
      continue
    }
    if (line.startsWith('rename from ')) {
      file.isRename = true
      file.oldPath = unquotePath(line.slice('rename from '.length))
      continue
    }
    if (line.startsWith('rename to ')) {
      file.isRename = true
      file.newPath = unquotePath(line.slice('rename to '.length))
      continue
    }
    if (line.startsWith('copy from ')) {
      file.oldPath = unquotePath(line.slice('copy from '.length))
      continue
    }
    if (line.startsWith('copy to ')) {
      file.newPath = unquotePath(line.slice('copy to '.length))
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.binary = true
      continue
    }
    if (line.startsWith('--- ')) {
      const p = headerPath(line.slice(4))
      if (p === null) file.isNew = true
      else if (!file.oldPath) file.oldPath = p
      continue
    }
    if (line.startsWith('+++ ')) {
      const p = headerPath(line.slice(4))
      if (p === null) file.isDeleted = true
      else if (!file.newPath) file.newPath = p
      continue
    }

    const m = HUNK_RE.exec(line)
    if (m) {
      if (combined) {
        hunk = null
        continue
      }
      oldLine = Number(m[1])
      newLine = Number(m[3])
      hunk = {
        oldStart: oldLine,
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: newLine,
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        heading: m[5] ?? '',
        lines: [],
      }
      file.hunks.push(hunk)
      continue
    }

    if (!hunk) continue

    if (line.startsWith('\\')) {
      // "\ No newline at end of file" refers to the preceding line.
      const prev = hunk.lines[hunk.lines.length - 1]
      if (prev) prev.noNewline = true
      continue
    }

    const marker = line[0]
    const content = line.slice(1)
    if (marker === '+') {
      hunk.lines.push({ type: 'add', oldLine: null, newLine: newLine++, content })
      file.additions++
    } else if (marker === '-') {
      hunk.lines.push({ type: 'del', oldLine: oldLine++, newLine: null, content })
      file.deletions++
    } else if (marker === ' ') {
      hunk.lines.push({ type: 'context', oldLine: oldLine++, newLine: newLine++, content })
    } else if (line === '') {
      // Trailing blank line at the very end of the patch: only a real context
      // line if the hunk still expects more lines.
      const seen = hunk.lines.length
      if (seen < hunk.oldLines + hunk.newLines && i < lines.length - 1) {
        hunk.lines.push({ type: 'context', oldLine: oldLine++, newLine: newLine++, content: '' })
      }
    } else {
      // Anything else ends the hunk (e.g. the next `diff --git`, already handled).
      hunk = null
    }
  }

  return files
}

/** `diff --git a/x b/y` — ambiguous when paths contain spaces, so try quoting first. */
function parseDiffGitHeader(line: string): [string, string] | null {
  const rest = line.slice(line.indexOf(' --git ') + 7)
  if (rest.startsWith('"')) {
    const end = findClosingQuote(rest)
    if (end > 0) {
      const a = unquotePath(rest.slice(0, end + 1))
      const b = unquotePath(rest.slice(end + 2))
      return [stripPrefix(a), stripPrefix(b)]
    }
  }
  // Prefer the split that makes both halves agree on their a//b prefixes.
  const parts = rest.split(' ')
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join(' ')
    const b = parts.slice(i).join(' ')
    if ((a.startsWith('a/') || a === '/dev/null') && (b.startsWith('b/') || b === '/dev/null')) {
      return [stripPrefix(a), stripPrefix(b)]
    }
  }
  const half = Math.floor(parts.length / 2)
  return [stripPrefix(parts.slice(0, half).join(' ')), stripPrefix(parts.slice(half).join(' '))]
}

function findClosingQuote(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') {
      i++
      continue
    }
    if (s[i] === '"') return i
  }
  return -1
}

/** Strip the `a/` / `b/` prefix git adds to header paths. */
function stripPrefix(p: string): string {
  if (p === '/dev/null') return p
  if (p.length > 2 && (p[1] === '/')) return p.slice(2)
  return p
}

/** `--- a/foo\t2024-01-01` -> `foo`; `/dev/null` -> null. */
function headerPath(raw: string): string | null {
  let value = raw
  const tab = value.indexOf('\t')
  if (tab >= 0) value = value.slice(0, tab)
  value = unquotePath(value.trim())
  if (value === '/dev/null') return null
  return stripPrefix(value)
}

/** Reverse git's C-style quoting of unusual path names. */
export function unquotePath(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"') || p.length < 2) return p
  const body = p.slice(1, -1)
  let out = ''
  const bytes: number[] = []
  const flush = () => {
    if (bytes.length) {
      out += new TextDecoder().decode(new Uint8Array(bytes))
      bytes.length = 0
    }
  }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== '\\') {
      flush()
      out += ch
      continue
    }
    const next = body[++i]
    if (next === undefined) break
    if (next >= '0' && next <= '7') {
      const oct = body.slice(i, i + 3)
      bytes.push(parseInt(oct, 8))
      i += 2
      continue
    }
    flush()
    switch (next) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case 'b': out += '\b'; break
      case 'f': out += '\f'; break
      case 'a': out += '\x07'; break
      case 'v': out += '\v'; break
      default: out += next
    }
  }
  flush()
  return out
}

/** Build a single all-additions hunk for a file that has no `old` side. */
export function wholeFileHunk(content: string): DiffHunk | null {
  if (content === '') return null
  const raw = content.split('\n')
  const endsWithNewline = raw.length > 1 && raw[raw.length - 1] === ''
  const body = endsWithNewline ? raw.slice(0, -1) : raw
  if (body.length === 0) return null
  const lines: DiffLine[] = body.map((content, idx) => ({
    type: 'add' as const,
    oldLine: null,
    newLine: idx + 1,
    content,
  }))
  if (!endsWithNewline && lines.length) lines[lines.length - 1].noNewline = true
  return { oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, heading: '', lines }
}
