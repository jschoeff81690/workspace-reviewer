import type { BaseInfo, CommitSummary, RepoCommits } from '../shared/types.ts'
import { git } from './git.ts'

const RECORD = '\x1e'
const FIELD = '\x1f'
const FORMAT = `%x1e%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%ar%x1f%P`
const SHORTSTAT =
  /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/

/** Commits ahead of the base are always listed, even past `limit`. */
const AHEAD_CAP = 200

export interface ListCommitsInput {
  repoName: string
  repoPath: string
  base: BaseInfo | null
  limit: number
}

/**
 * Recent history for one repo, newest first, each with its diffstat and a flag
 * for whether it is part of the branch's own work (ahead of the base).
 */
export async function listCommits(input: ListCommitsInput): Promise<RepoCommits> {
  const { repoName, repoPath, base, limit } = input

  const [logRes, aheadRes] = await Promise.all([
    // One extra commit tells us whether there is more history to offer.
    git(repoPath, ['log', '-n', String(limit + 1), `--format=${FORMAT}`, '--shortstat', 'HEAD']),
    base
      ? git(repoPath, ['rev-list', '-n', String(AHEAD_CAP), `${base.sha}..HEAD`])
      : Promise.resolve({ code: 1, stdout: '', stderr: '' }),
  ])

  if (logRes.code !== 0) {
    return { repo: repoName, base, commits: [], hasMore: false }
  }

  const ahead = new Set(
    aheadRes.code === 0 ? aheadRes.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : [],
  )

  const parsed = parseLog(logRes.stdout, ahead)
  const hasMore = parsed.length > limit
  return { repo: repoName, base, commits: hasMore ? parsed.slice(0, limit) : parsed, hasMore }
}

export function parseLog(out: string, ahead: Set<string>): CommitSummary[] {
  const commits: CommitSummary[] = []

  for (const record of out.split(RECORD)) {
    if (record.trim() === '') continue
    const lines = record.split('\n')
    const fields = lines[0].split(FIELD)
    if (fields.length < 7) continue
    const [sha, shortSha, subject, author, date, relativeDate, parents] = fields

    let filesChanged = 0
    let additions = 0
    let deletions = 0
    for (let i = 1; i < lines.length; i++) {
      const match = SHORTSTAT.exec(lines[i])
      if (!match) continue
      filesChanged = Number(match[1]) || 0
      additions = Number(match[2]) || 0
      deletions = Number(match[3]) || 0
      break
    }

    commits.push({
      sha,
      shortSha,
      subject,
      author,
      date,
      relativeDate,
      parents: parents.split(' ').filter(Boolean),
      filesChanged,
      additions,
      deletions,
      ahead: ahead.has(sha),
    })
  }

  return commits
}

/** The commits in `from..to`, newest first, all of them part of the branch. */
export async function listRange(
  repoPath: string,
  fromSha: string,
  toSha: string,
  limit: number,
): Promise<CommitSummary[]> {
  const res = await git(repoPath, [
    'log',
    '-n',
    String(limit),
    `--format=${FORMAT}`,
    '--shortstat',
    `${fromSha}..${toSha}`,
  ])
  if (res.code !== 0) return []
  const commits = parseLog(res.stdout, new Set())
  return commits.map((commit) => ({ ...commit, ahead: true }))
}
