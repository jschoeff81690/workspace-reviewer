import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { RepoStateStore } from './state.ts'
import { readStatus, statusSignature } from './status.ts'
import type { RepoHandle } from './workspace.ts'

const CONCURRENCY = 4
/** Never poll more often than this, however noisy the filesystem is. */
const MIN_POLL_GAP_MS = 300
const FS_DEBOUNCE_MS = 150

const NOISY = [
  'node_modules',
  '/.venv/',
  '__pycache__',
  '.pytest_cache',
  '/.idea/',
  '/.gradle/',
]

export interface WatcherOptions {
  repos: RepoHandle[]
  pollMs: number
  watchFs: boolean
  /** Populated on every poll so the API can answer without spawning git. */
  store: RepoStateStore
}

/**
 * Detects repo changes two ways: filesystem events for instant feedback, and a
 * poll of `git status` as the authority (and as a backstop when watches fail).
 */
export class WorkspaceWatcher extends EventEmitter {
  private signatures = new Map<string, string>()
  private watchers: FSWatcher[] = []
  private timer: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private lastPoll = 0
  private polling = false
  private pendingPoll = false
  private stopped = false

  private readonly options: WatcherOptions

  constructor(options: WatcherOptions) {
    super()
    this.options = options
  }

  async start(): Promise<void> {
    await this.poll(true)
    if (this.options.watchFs) this.attachFsWatchers()
    this.schedule()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    for (const watcher of this.watchers) watcher.close()
    this.watchers = []
  }

  /** Force a poll now (used by the manual refresh button). */
  async refresh(): Promise<string[]> {
    return await this.poll(false)
  }

  private schedule(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      void this.poll(false).finally(() => this.schedule())
    }, this.options.pollMs)
  }

  private attachFsWatchers(): void {
    for (const repo of this.options.repos) {
      this.tryWatch(repo.path, true)
      this.tryWatch(path.join(repo.path, '.git'), false)
    }
  }

  private tryWatch(target: string, recursive: boolean): void {
    try {
      const watcher = watch(target, { recursive, persistent: false }, (_event, filename) => {
        const name = filename ? String(filename) : ''
        if (name && NOISY.some((frag) => name.includes(frag))) return
        this.onFsEvent()
      })
      watcher.on('error', () => watcher.close())
      this.watchers.push(watcher)
    } catch {
      // Recursive watches are unsupported on some platforms; the poll covers us.
    }
  }

  private onFsEvent(): void {
    if (this.debounce) return
    this.debounce = setTimeout(() => {
      this.debounce = null
      void this.poll(false)
    }, FS_DEBOUNCE_MS)
  }

  private async poll(initial: boolean): Promise<string[]> {
    if (this.stopped) return []
    if (this.polling) {
      this.pendingPoll = true
      return []
    }
    const since = Date.now() - this.lastPoll
    if (!initial && since < MIN_POLL_GAP_MS) {
      this.onFsEvent()
      return []
    }
    this.polling = true
    this.lastPoll = Date.now()

    const changed: string[] = []
    try {
      const queue = [...this.options.repos]
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const repo = queue.shift()
          if (!repo) return
          const signature = await this.signatureFor(repo)
          if (this.signatures.get(repo.name) !== signature) {
            this.signatures.set(repo.name, signature)
            if (!initial) changed.push(repo.name)
          }
        }
      })
      await Promise.all(workers)
    } finally {
      this.polling = false
      this.lastPoll = Date.now()
    }

    if (changed.length) this.emit('change', changed)
    if (this.pendingPoll) {
      this.pendingPoll = false
      this.onFsEvent()
    }
    return changed
  }

  private async signatureFor(repo: RepoHandle): Promise<string> {
    try {
      const status = await readStatus(repo.path)
      this.options.store.set(repo.name, status)
      return statusSignature(status)
    } catch (err) {
      this.options.store.invalidate(repo.name)
      return `error:${err instanceof Error ? err.message : String(err)}`
    }
  }
}
