import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { createApp } from '../src/server/app.ts'
import { resolveBase } from '../src/server/base.ts'
import { listCommits } from '../src/server/log.ts'
import { readStatus } from '../src/server/status.ts'
import { discoverRepos, summarizeRepo } from '../src/server/workspace.ts'
import type { FileDiff, RepoChanges, RepoCommits, WorkspaceInfo } from '../src/shared/types.ts'
import { check, equal, suite } from './assert.ts'
import type { Fixture } from './fixture.ts'

export async function run(fixture: Fixture): Promise<void> {
  const { gamma, gammaCommits } = fixture
  const [c1, c2, c3] = gammaCommits.feature

  suite('base resolution')
  {
    const status = await readStatus(gamma)
    const base = await resolveBase({
      repoPath: gamma,
      headSha: status.branch.oid,
      branch: status.branch.branch,
      upstream: status.branch.upstream,
    })
    equal('finds the base the remote names', base?.ref, 'origin/main')
    equal('records how it was found', base?.source, 'origin-head')
    equal('counts the branch commits', base?.ahead, 3)
    equal('counts the base commits it lacks', base?.behind, 1)
    equal('merge base is the branch point', base?.mergeBase, gammaCommits.mergeBase)

    const overridden = await resolveBase({
      repoPath: gamma,
      headSha: status.branch.oid,
      branch: status.branch.branch,
      upstream: status.branch.upstream,
      override: c1,
    })
    equal('an explicit base wins', overridden?.ref, c1)
    equal('and is measured from there', overridden?.ahead, 2)

    // A repo sitting on its own base branch has nothing to compare against.
    const alphaStatus = await readStatus(fixture.alpha)
    const alphaBase = await resolveBase({
      repoPath: fixture.alpha,
      headSha: alphaStatus.branch.oid,
      branch: alphaStatus.branch.branch,
      upstream: alphaStatus.branch.upstream,
    })
    check('no base when the only candidate is the current branch', alphaBase === null)
  }

  suite('commit list')
  {
    const summary = await summarizeRepo({ name: 'gamma', path: gamma })
    check('branch comparison offered', summary.availableModes.includes('branch'))

    const listed = await listCommits({
      repoName: 'gamma',
      repoPath: gamma,
      base: summary.base,
      limit: 4,
    })
    equal('newest first', listed.commits.map((c) => c.subject.slice(0, 2)), ['C3', 'C2', 'C1', 'B:'])
    equal(
      'marks which commits are the branch own work',
      listed.commits.map((c) => c.ahead),
      [true, true, true, false],
    )
    check('more history available', listed.hasMore)
    const c2Summary = listed.commits[1]
    // C2 rewrites both lines of service.py and adds a two-line helper.py.
    equal('per-commit diffstat', [c2Summary.filesChanged, c2Summary.additions, c2Summary.deletions], [2, 4, 2])
    equal('parents recorded', c2Summary.parents, [c1])
    check('author and dates present', !!c2Summary.author && !!c2Summary.relativeDate)

    const capped = await listCommits({ repoName: 'gamma', repoPath: gamma, base: summary.base, limit: 99 })
    check('hasMore is false once the history fits', !capped.hasMore)
    equal('full history length', capped.commits.length, 5)
  }

  suite('commit and branch comparisons')
  {
    const dirs = await discoverRepos({ root: fixture.root, depth: 1 })
    const repos = dirs.map((dir) => ({ name: path.basename(dir), path: dir }))
    const app = createApp({
      root: fixture.root,
      repos,
      watcher: null,
      store: null,
      serverId: 'test',
      clientDir: null,
      pollMs: 0,
    })
    const server = createServer(app.handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const base = `http://127.0.0.1:${port}`
    const get = async <T>(url: string): Promise<T> => (await fetch(base + url)).json() as Promise<T>

    try {
      const workspace = await get<WorkspaceInfo>('/api/workspace')
      const gammaSummary = workspace.repos.find((r) => r.name === 'gamma')!
      equal('summary carries the base', gammaSummary.base?.ref, 'origin/main')
      equal('summary carries the ahead count', gammaSummary.base?.ahead, 3)

      const commits = await get<RepoCommits>('/api/repos/gamma/commits?limit=10')
      equal('commits endpoint returns the stack', commits.commits.filter((c) => c.ahead).length, 3)

      // One commit at a time.
      const single = await get<RepoChanges>(`/api/repos/gamma/changes?mode=commit&ref=${c2}`)
      equal('a single commit lists only its files', single.files.map((f) => f.path), [
        'helper.py',
        'service.py',
      ])
      equal('and names the commit', single.commit?.subject.slice(0, 2), 'C2')
      equal('helper.py is new in C2', single.files.find((f) => f.path === 'helper.py')?.status, 'added')
      equal(
        'service.py is only modified in C2',
        single.files.find((f) => f.path === 'service.py')?.status,
        'modified',
      )

      const first = await get<RepoChanges>(`/api/repos/gamma/changes?mode=commit&ref=${c1}`)
      equal('C1 only adds the handler', first.files.map((f) => f.path), ['service.py'])
      equal('added in C1', first.files[0].status, 'added')

      // All three commits as one diff.
      const branch = await get<RepoChanges>('/api/repos/gamma/changes?mode=branch')
      equal('branch diff covers the whole stack', branch.files.map((f) => f.path), [
        'helper.py',
        'service.py',
      ])
      equal('branch label names the base and count', branch.label, 'origin/main → HEAD (3 commits)')
      equal('branch diff lists its commits', branch.commits.map((c) => c.subject.slice(0, 2)), [
        'C3',
        'C2',
        'C1',
      ])
      check('branch commits are all marked ahead', branch.commits.every((c) => c.ahead))

      // The property that makes this correct: the base moved on after the
      // branch point, and that commit must not appear in the branch diff.
      check(
        'changes made on the base after the branch point are excluded',
        !branch.files.some((f) => f.path === 'base-only.txt'),
      )

      // Each file shows its net change across the stack, not per commit.
      const helperBranch = await get<FileDiff>(
        '/api/repos/gamma/file?mode=branch&path=helper.py',
      )
      equal('net status across the stack', helperBranch.status, 'added')
      check('final content, from the branch tip', helperBranch.newContent?.includes('def helper(name)') === true)
      equal('nothing on the old side', helperBranch.oldContent, null)

      const helperAtC2 = await get<FileDiff>(
        `/api/repos/gamma/file?mode=commit&ref=${c2}&path=helper.py`,
      )
      check('the same file at C2 has its intermediate content', helperAtC2.newContent === 'def helper():\n    return "help"\n')

      const serviceBranch = await get<FileDiff>('/api/repos/gamma/file?mode=branch&path=service.py')
      equal('old side comes from the merge base, where the file was absent', serviceBranch.oldContent, null)
      check('new side is the branch tip', serviceBranch.newContent?.includes('def handle(request)') === true)

      // An explicit base narrows the range.
      const narrowed = await get<RepoChanges>(`/api/repos/gamma/changes?mode=branch&base=${c1}`)
      equal('explicit base narrows the stack', narrowed.comparison.base, c1)
      equal('two commits remain', narrowed.commits.length, 2)

      const lastOne = await get<RepoChanges>('/api/repos/gamma/changes?mode=lastCommit')
      equal('last commit is the branch tip', lastOne.commit?.sha, c3)
      equal('and shows only its own file', lastOne.files.map((f) => f.path), ['helper.py'])

      // A repo with no base cannot offer a branch diff.
      const noBase = await fetch(`${base}/api/repos/alpha/changes?mode=branch`)
      equal('branch mode without a base is refused', noBase.status, 409)

      const errors = await Promise.all([
        fetch(`${base}/api/repos/gamma/changes?mode=commit&ref=0123456789abcdef0123`),
        fetch(`${base}/api/repos/gamma/changes?mode=commit`),
        fetch(`${base}/api/repos/gamma/changes?mode=commit&ref=--upload-pack=touch`),
        fetch(`${base}/api/repos/gamma/changes?mode=commit&ref=HEAD..main`),
        fetch(`${base}/api/repos/gamma/changes?mode=branch&base=nope/nope`),
      ])
      equal(
        'bad refs are rejected, not passed to git',
        errors.map((r) => r.status),
        [404, 400, 400, 400, 404],
      )
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
