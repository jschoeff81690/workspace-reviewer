import type { RepoStatus } from './status.ts'

interface Entry {
  status: RepoStatus
  at: number
}

/**
 * The watcher's latest `git status` per repo, shared with the API so a
 * workspace refresh costs no git processes between polls.
 */
export class RepoStateStore {
  private readonly entries = new Map<string, Entry>()

  set(name: string, status: RepoStatus): void {
    this.entries.set(name, { status, at: Date.now() })
  }

  get(name: string, maxAgeMs: number): RepoStatus | null {
    const entry = this.entries.get(name)
    if (!entry) return null
    return Date.now() - entry.at <= maxAgeMs ? entry.status : null
  }

  invalidate(name?: string): void {
    if (name === undefined) this.entries.clear()
    else this.entries.delete(name)
  }
}
