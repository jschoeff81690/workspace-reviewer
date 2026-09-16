import { execFile } from 'node:child_process'
import type { CommitInfo } from '../shared/types.ts'

/** The well-known hash of git's empty tree, used as a base for root commits. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

const MAX_BUFFER = 256 * 1024 * 1024

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

const BASE_ARGS = ['-c', 'core.quotePath=false', '-c', 'color.ui=false']

/** Run git in `cwd`. Non-zero exits resolve (diff uses exit 1 for "differs"). */
export function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...BASE_ARGS, ...args],
      { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err && typeof (err as { code?: unknown }).code !== 'number') {
          reject(err)
          return
        }
        resolve({ code: err ? Number((err as { code: number }).code) : 0, stdout, stderr })
      },
    )
  })
}

/** Run git and return stdout, throwing on failure. */
export async function gitOk(cwd: string, args: string[]): Promise<string> {
  const res = await git(cwd, args)
  if (res.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${res.stderr.trim() || `exit ${res.code}`}`)
  }
  return res.stdout
}

/** Run git capturing raw bytes (for blobs, which may not be UTF-8). */
export function gitBuffer(cwd: string, args: string[]): Promise<{ code: number; stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...BASE_ARGS, ...args],
      { cwd, maxBuffer: MAX_BUFFER, encoding: 'buffer', windowsHide: true },
      (err, stdout) => {
        if (err && typeof (err as { code?: unknown }).code !== 'number') {
          reject(err)
          return
        }
        resolve({ code: err ? Number((err as { code: number }).code) : 0, stdout: stdout as Buffer })
      },
    )
  })
}

export function splitZ(out: string): string[] {
  const parts = out.split('\0')
  if (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts
}

const COMMIT_FORMAT = ['%H', '%h', '%s', '%an', '%aI', '%ar'].join('%x1f')

export async function readCommit(cwd: string, ref: string): Promise<CommitInfo | null> {
  const res = await git(cwd, ['log', '-1', `--format=${COMMIT_FORMAT}`, ref, '--'])
  if (res.code !== 0) return null
  const line = res.stdout.split('\n')[0]
  if (!line) return null
  const [sha, shortSha, subject, author, date, relativeDate] = line.split('\x1f')
  if (!sha) return null
  return { sha, shortSha, subject, author, date, relativeDate }
}

export async function revParse(cwd: string, ref: string): Promise<string | null> {
  const res = await git(cwd, ['rev-parse', '--verify', '--quiet', ref])
  if (res.code !== 0) return null
  const sha = res.stdout.trim()
  return sha || null
}

/** Absolute path of the repository root, or null if `dir` is not in a work tree. */
export async function toplevel(dir: string): Promise<string | null> {
  const res = await git(dir, ['rev-parse', '--show-toplevel'])
  if (res.code !== 0) return null
  const out = res.stdout.trim()
  return out || null
}

/**
 * Refs arrive from the URL and are interpolated into git arguments, so they are
 * restricted to the characters real ref names use. Anything with a leading dash
 * (option injection) or a range operator is refused.
 */
const SAFE_REF = /^[A-Za-z0-9._/~^{}@+-]{1,255}$/

export function isSafeRef(ref: string): boolean {
  if (!SAFE_REF.test(ref)) return false
  if (ref.startsWith('-')) return false
  if (ref.includes('..')) return false
  return true
}

/** Validate a caller-supplied ref and resolve it to a commit sha. */
export async function resolveCommitish(cwd: string, ref: string): Promise<string | null> {
  if (!isSafeRef(ref)) return null
  return await revParse(cwd, `${ref}^{commit}`)
}
