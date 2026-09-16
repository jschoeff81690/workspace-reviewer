import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  BaseInfo,
  CompareMode,
  Comparison,
  RepoSummary,
  WorkspaceInfo,
} from '../shared/types.ts'
import { COMPARE_MODES } from '../shared/types.ts'
import { resolveBase } from './base.ts'
import { listChanges } from './changes.ts'
import { mapLimit } from './concurrency.ts'
import { getFileDiff } from './filediff.ts'
import { isSafeRef } from './git.ts'
import { listCommits } from './log.ts'
import { ComparisonError } from './modes.ts'
import { readStatus } from './status.ts'
import { openSse, sendError, sendJson, serveStatic, type SseClient } from './http.ts'
import type { RepoStateStore } from './state.ts'
import type { WorkspaceWatcher } from './watcher.ts'
import { summarizeRepo, type RepoHandle } from './workspace.ts'

export interface AppContext {
  root: string
  repos: RepoHandle[]
  watcher: WorkspaceWatcher | null
  /** Shared with the watcher; null means every request re-runs git status. */
  store: RepoStateStore | null
  serverId: string
  clientDir: string | null
  pollMs: number
  /** `--base` override applied to every repo. */
  baseOverride?: string
}

/** Coalesce bursts of workspace requests (the UI refetches several at once). */
const SUMMARY_TTL_MS = 200
/** Default length of the per-repo commit list. */
const COMMIT_LIMIT = 30
const COMMIT_LIMIT_MAX = 500
/** Simultaneous git invocations while summarizing the workspace. */
const SUMMARY_CONCURRENCY = 6

export function createApp(ctx: AppContext) {
  const repoByName = new Map(ctx.repos.map((repo) => [repo.name, repo]))
  const clients = new Set<SseClient>()

  let summaryCache: { at: number; value: Promise<RepoSummary[]> } | null = null
  const summaries = (): Promise<RepoSummary[]> => {
    const now = Date.now()
    if (summaryCache && now - summaryCache.at < SUMMARY_TTL_MS) return summaryCache.value
    // Reuse the watcher's poll while it is fresh; otherwise read git directly.
    // Capped so a long poll interval cannot serve stale counts to a new tab.
    const maxAge = Math.min(Math.max(ctx.pollMs * 2, 1_000), 3_000)
    const value = mapLimit(ctx.repos, SUMMARY_CONCURRENCY, (repo) =>
      summarizeRepo(repo, {
        status: ctx.store?.get(repo.name, maxAge) ?? undefined,
        baseOverride: ctx.baseOverride,
      }),
    )
    summaryCache = { at: now, value }
    return value
  }

  ctx.watcher?.on('change', (repos: string[]) => {
    summaryCache = null
    for (const client of clients) client.send('change', { repos })
  })

  /** The repo's base branch, from the watcher's status when it is fresh. */
  const baseFor = async (repo: RepoHandle): Promise<BaseInfo | null> => {
    const cached = ctx.store?.get(repo.name, Math.max(ctx.pollMs * 2, 1_000))
    const status = cached ?? (await readStatus(repo.path).catch(() => null))
    if (!status) return null
    return await resolveBase({
      repoPath: repo.path,
      headSha: status.branch.oid,
      branch: status.branch.branch,
      upstream: status.branch.upstream,
      override: ctx.baseOverride,
    })
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const { pathname } = url

    if (!pathname.startsWith('/api/')) {
      if (!ctx.clientDir) {
        sendError(res, 404, 'client assets are not built; run `npm run build` or use `npm run dev`')
        return
      }
      await serveStatic(req, res, ctx.clientDir, pathname)
      return
    }

    // The browser is the only intended caller; keep it that way.
    res.setHeader('access-control-allow-origin', 'http://localhost:4301')

    if (pathname === '/api/health') {
      sendJson(res, 200, { ok: true, serverId: ctx.serverId, root: ctx.root })
      return
    }

    if (pathname === '/api/events') {
      const client = openSse(req, res)
      clients.add(client)
      client.send('hello', { serverId: ctx.serverId })
      req.on('close', () => {
        clients.delete(client)
      })
      return
    }

    if (pathname === '/api/workspace') {
      const repos = await summaries()
      const body: WorkspaceInfo = {
        root: ctx.root,
        repos,
        generatedAt: new Date().toISOString(),
        serverId: ctx.serverId,
        pollMs: ctx.pollMs,
      }
      sendJson(res, 200, body)
      return
    }

    if (pathname === '/api/refresh') {
      summaryCache = null
      const changed = (await ctx.watcher?.refresh()) ?? []
      sendJson(res, 200, { changed })
      return
    }

    const match = /^\/api\/repos\/([^/]+)\/(changes|file|commits)$/.exec(pathname)
    if (match) {
      const repo = repoByName.get(decodeURIComponent(match[1]))
      if (!repo) {
        sendError(res, 404, `unknown repo: ${decodeURIComponent(match[1])}`)
        return
      }

      if (match[2] === 'commits') {
        const limit = Math.min(
          Math.max(Number(url.searchParams.get('limit')) || COMMIT_LIMIT, 1),
          COMMIT_LIMIT_MAX,
        )
        sendJson(res, 200, {
          ...(await listCommits({
            repoName: repo.name,
            repoPath: repo.path,
            base: await baseFor(repo),
            limit,
          })),
        })
        return
      }

      const comparison = parseComparison(url.searchParams)
      if (!comparison) {
        sendError(res, 400, `mode must be one of ${COMPARE_MODES.join(', ')}, with a valid ref`)
        return
      }
      const base = await baseFor(repo)

      try {
        if (match[2] === 'changes') {
          sendJson(res, 200, await listChanges(repo.name, repo.path, comparison, base))
          return
        }

        const filePath = url.searchParams.get('path')
        if (!filePath || !isSafeRelativePath(filePath)) {
          sendError(res, 400, 'path is required and must be relative to the repo root')
          return
        }
        const oldPath = url.searchParams.get('oldPath')
        if (oldPath && !isSafeRelativePath(oldPath)) {
          sendError(res, 400, 'oldPath must be relative to the repo root')
          return
        }
        sendJson(
          res,
          200,
          await getFileDiff({
            repoName: repo.name,
            repoPath: repo.path,
            comparison,
            base,
            filePath,
            oldPath: oldPath ?? undefined,
          }),
        )
      } catch (err) {
        if (err instanceof ComparisonError) {
          sendError(res, err.status, err.message)
          return
        }
        throw err
      }
      return
    }

    sendError(res, 404, `no route for ${pathname}`)
  }

  const wrapped = (req: IncomingMessage, res: ServerResponse): void => {
    handler(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) sendError(res, 500, message)
      else res.end()
    })
  }

  return {
    handler: wrapped,
    broadcast: (event: string, data: unknown) => {
      for (const client of clients) client.send(event, data)
    },
    closeClients: () => {
      for (const client of clients) client.close()
      clients.clear()
    },
  }
}

function parseMode(raw: string | null): CompareMode | null {
  if (!raw) return 'worktree'
  return (COMPARE_MODES as string[]).includes(raw) ? (raw as CompareMode) : null
}

/** `?mode=commit&ref=<sha>` / `?mode=branch&base=origin/main`. */
function parseComparison(params: URLSearchParams): Comparison | null {
  const mode = parseMode(params.get('mode'))
  if (!mode) return null
  const ref = params.get('ref')
  const base = params.get('base')
  if (ref !== null && !isSafeRef(ref)) return null
  if (base !== null && !isSafeRef(base)) return null
  if (mode === 'commit' && !ref) return null
  return {
    mode,
    ...(ref ? { ref } : {}),
    ...(base ? { base } : {}),
  }
}

/** Paths come from git output, but they arrive via the URL; re-check them. */
function isSafeRelativePath(candidate: string): boolean {
  if (candidate.startsWith('/') || candidate.includes('\0')) return false
  if (/^[a-zA-Z]:[\\/]/.test(candidate)) return false
  return !candidate.split(/[\\/]/).includes('..')
}
