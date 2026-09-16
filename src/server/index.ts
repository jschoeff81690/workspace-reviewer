import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createApp } from './app.ts'
import { mapLimit } from './concurrency.ts'
import { RepoStateStore } from './state.ts'
import { WorkspaceWatcher } from './watcher.ts'
import { discoverRepos, summarizeRepo, type RepoHandle } from './workspace.ts'

const DEFAULT_PORT = 4300
const PORT_ATTEMPTS = 25
/** Filesystem events drive updates; the poll is only a backstop. */
const DEFAULT_POLL_WATCHING = 4000
/** Without watches the poll is the only signal, so it has to be brisk. */
const DEFAULT_POLL_BARE = 1500

const HELP = `ws-reviewer - browse diffs across a workspace of git repos

Usage
  ws-reviewer [directory] [options]

Options
  -p, --port <n>     Port to listen on (default ${DEFAULT_PORT}, tries the next free one)
  -d, --depth <n>    How deep to search for repos below the directory (default 1)
  -b, --base <ref>   Base branch for the "Branch" comparison (default: the
                     branch's upstream, else origin/HEAD, else main/master)
      --poll <ms>    Change-poll interval in ms (default 4000, or 1500 with --no-watch)
      --host <addr>  Interface to bind (default 127.0.0.1)
      --no-open      Do not open a browser
      --no-watch     Disable filesystem watching (poll only)
      --api-only     Serve only the API, for use with the Vite dev server
  -v, --version      Print the version
  -h, --help         Print this help

The directory defaults to the current working directory. Every git work tree
found below it becomes a repo in the left pane.
`

interface Options {
  root: string
  port: number
  host: string
  depth: number
  base?: string
  pollMs: number
  open: boolean
  watchFs: boolean
  apiOnly: boolean
}

function parseOptions(argv: string[]): Options | { help: true } | { version: true } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string', short: 'p' },
      depth: { type: 'string', short: 'd' },
      base: { type: 'string', short: 'b' },
      poll: { type: 'string' },
      host: { type: 'string' },
      'no-open': { type: 'boolean' },
      'no-watch': { type: 'boolean' },
      'api-only': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })

  if (values.help) return { help: true }
  if (values.version) return { version: true }

  const watchFs = !values['no-watch']
  return {
    root: path.resolve(positionals[0] ?? process.cwd()),
    port: numberOr(values.port, DEFAULT_PORT),
    host: values.host ?? '127.0.0.1',
    depth: numberOr(values.depth, 1),
    ...(values.base ? { base: values.base } : {}),
    pollMs: Math.max(250, numberOr(values.poll, watchFs ? DEFAULT_POLL_WATCHING : DEFAULT_POLL_BARE)),
    open: !values['no-open'],
    watchFs,
    apiOnly: !!values['api-only'],
  }
}

function numberOr(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? NaN : Number(raw)
  return Number.isFinite(value) ? value : fallback
}

async function packageVersion(): Promise<string> {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const raw = await readFile(path.resolve(here, '../../package.json'), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

async function resolveClientDir(): Promise<string | null> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const candidate of [path.resolve(here, '../client'), path.resolve(here, '../../dist/client')]) {
    try {
      await stat(path.join(candidate, 'index.html'))
      return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

async function listen(handler: Parameters<typeof createServer>[1], host: string, startPort: number): Promise<{ port: number; close: () => Promise<void> }> {
  for (let offset = 0; offset < PORT_ATTEMPTS; offset++) {
    const port = startPort + offset
    const server = createServer(handler)
    server.keepAliveTimeout = 0
    const ok = await new Promise<boolean>((resolve) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.close()
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve(false)
        else {
          console.error(err)
          process.exit(1)
        }
      }
      server.once('error', onError)
      server.listen(port, host, () => {
        server.removeListener('error', onError)
        resolve(true)
      })
    })
    if (ok) {
      return {
        port,
        close: () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections()
            server.close(() => resolve())
          }),
      }
    }
  }
  throw new Error(`no free port in ${startPort}-${startPort + PORT_ATTEMPTS - 1}`)
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // Not fatal: the URL is printed anyway.
  }
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseOptions(argv)
  if ('help' in parsed) {
    process.stdout.write(HELP)
    return
  }
  if ('version' in parsed) {
    process.stdout.write(`${await packageVersion()}\n`)
    return
  }
  const options = parsed

  const dirs = await discoverRepos({ root: options.root, depth: options.depth })
  if (dirs.length === 0) {
    console.error(`ws-reviewer: no git repositories found in ${options.root} (depth ${options.depth})`)
    process.exitCode = 1
    return
  }

  const repos: RepoHandle[] = dirs.map((dir) => ({ name: path.basename(dir), path: dir }))
  dedupeNames(repos, options.root)

  const store = new RepoStateStore()
  const watcher = new WorkspaceWatcher({
    repos,
    pollMs: options.pollMs,
    watchFs: options.watchFs,
    store,
  })
  await watcher.start()

  const clientDir = options.apiOnly ? null : await resolveClientDir()
  const app = createApp({
    root: options.root,
    repos,
    watcher,
    store,
    serverId: randomUUID(),
    clientDir,
    pollMs: options.pollMs,
    ...(options.base ? { baseOverride: options.base } : {}),
  })

  const server = await listen(app.handler, options.host, options.port)
  const url = `http://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${server.port}`

  await printBanner(repos, options, url, clientDir, store)
  if (options.open && !options.apiOnly) openBrowser(url)

  const shutdown = (): void => {
    process.stdout.write('\nws-reviewer: shutting down\n')
    watcher.stop()
    app.closeClients()
    void server.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/** Two repos can share a directory name at different depths; keep ids unique. */
function dedupeNames(repos: RepoHandle[], root: string): void {
  const seen = new Map<string, number>()
  for (const repo of repos) {
    const count = seen.get(repo.name) ?? 0
    seen.set(repo.name, count + 1)
    if (count > 0) {
      const rel = path.relative(root, repo.path)
      repo.name = rel || repo.name
    }
  }
}

async function printBanner(
  repos: RepoHandle[],
  options: Options,
  url: string,
  clientDir: string | null,
  store: RepoStateStore,
): Promise<void> {
  const summaries = await mapLimit(repos, 6, (repo) =>
    summarizeRepo(repo, {
      status: store.get(repo.name, 5_000) ?? undefined,
      ...(options.base ? { baseOverride: options.base } : {}),
    }),
  )
  const width = Math.max(...summaries.map((r) => r.name.length))
  const lines = summaries.map((repo) => {
    const counts = repo.counts
    const state = repo.error
      ? `error: ${repo.error}`
      : repo.dirty
        ? [
            counts.staged ? `${counts.staged} staged` : null,
            counts.unstaged ? `${counts.unstaged} unstaged` : null,
            counts.untracked ? `${counts.untracked} untracked` : null,
            counts.conflicted ? `${counts.conflicted} conflicted` : null,
          ]
            .filter(Boolean)
            .join(', ')
        : `clean · ${repo.head?.shortSha ?? 'no commits'} ${repo.head?.subject ?? ''}`.slice(0, 44)
    const marker = repo.error ? '!' : repo.dirty ? '●' : '○'
    const ahead =
      repo.base && repo.base.ahead > 0 ? `  [${repo.base.ahead} ahead of ${repo.base.ref}]` : ''
    return `  ${marker} ${repo.name.padEnd(width)}  ${repo.branch ?? 'detached'}  ${state}${ahead}`
  })

  const dirtyCount = summaries.filter((r) => r.dirty).length
  process.stdout.write(
    [
      '',
      `ws-reviewer  ${await packageVersion()}`,
      `  workspace  ${options.root}`,
      `  repos      ${repos.length} (${dirtyCount} with changes)`,
      `  live       poll ${options.pollMs}ms${options.watchFs ? ' + fs events' : ''}`,
      clientDir === null && !options.apiOnly
        ? '  client     NOT BUILT - run `npm run build`'
        : `  url        ${url}`,
      '',
      ...lines,
      '',
    ].join('\n'),
  )
}
