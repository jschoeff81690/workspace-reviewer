import { createServer } from 'node:http'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/server/app.ts'
import { discoverRepos } from '../src/server/workspace.ts'
import type { FileDiff, RepoChanges, WorkspaceInfo } from '../src/shared/types.ts'
import { check, equal, suite } from './assert.ts'
import type { Fixture } from './fixture.ts'

export async function run(fixture: Fixture): Promise<void> {
  suite('api')

  const dirs = await discoverRepos({ root: fixture.root, depth: 1 })
  const repos = dirs.map((dir) => ({ name: path.basename(dir), path: dir }))
  equal('discovers every repo', repos.map((r) => r.name).sort(), ['alpha', 'beta', 'gamma'])

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
    const alpha = workspace.repos.find((r) => r.name === 'alpha')!
    const beta = workspace.repos.find((r) => r.name === 'beta')!
    check('alpha is dirty', alpha.dirty)
    equal('alpha opens on the working tree', alpha.defaultMode, 'worktree')
    // git status reports `newdir/` as one untracked entry; the tree expands it
    // into its files, so the file list is longer than the untracked count.
    equal('alpha counts', alpha.counts, { staged: 2, unstaged: 3, untracked: 3, conflicted: 0 })
    equal('alpha offers every uncommitted mode', alpha.availableModes, [
      'worktree',
      'staged',
      'unstaged',
      'lastCommit',
      'commit',
    ])
    check('alpha has no base branch (it is on main, with no remote)', alpha.base === null)
    check('alpha cannot offer a branch diff without a base', !alpha.availableModes.includes('branch'))
    check('beta is clean', !beta.dirty)
    equal('beta opens on its last commit', beta.defaultMode, 'lastCommit')
    equal('beta only offers commit comparisons', beta.availableModes, ['lastCommit', 'commit'])
    equal('beta head subject', beta.head?.subject, 'Restyle the title')
    equal('branch reported', [alpha.branch, beta.branch], ['main', 'main'])

    const worktree = await get<RepoChanges>('/api/repos/alpha/changes?mode=worktree')
    equal(
      'worktree lists staged, unstaged and untracked together',
      worktree.files.map((f) => `${f.status}:${f.path}`).sort(),
      [
        'deleted:README.md',
        'modified:long.ts',
        'modified:main.go',
        'modified:src/server.ts',
        'renamed:newname.py',
        'untracked:blob.bin',
        'untracked:newdir/one.txt',
        'untracked:newdir/two.txt',
        'untracked:untracked.py',
      ],
    )
    const stagedFile = worktree.files.find((f) => f.path === 'main.go')!
    equal('staged flag set', [stagedFile.staged, stagedFile.unstaged], [true, false])
    const unstagedFile = worktree.files.find((f) => f.path === 'src/server.ts')!
    equal('unstaged flag set', [unstagedFile.staged, unstagedFile.unstaged], [false, true])
    check('untracked dir expanded into files', worktree.files.some((f) => f.path === 'newdir/two.txt'))
    check('binary flagged', worktree.files.find((f) => f.path === 'blob.bin')?.binary === true)
    equal('rename carries the old path', worktree.files.find((f) => f.path === 'newname.py')?.oldPath, 'oldname.py')

    const staged = await get<RepoChanges>('/api/repos/alpha/changes?mode=staged')
    equal(
      'staged mode shows only index changes',
      staged.files.map((f) => f.path).sort(),
      ['main.go', 'newname.py'],
    )

    const unstaged = await get<RepoChanges>('/api/repos/alpha/changes?mode=unstaged')
    check('unstaged mode excludes the staged file', !unstaged.files.some((f) => f.path === 'main.go'))
    check('unstaged mode includes untracked', unstaged.files.some((f) => f.path === 'untracked.py'))

    const lastCommit = await get<RepoChanges>('/api/repos/beta/changes?mode=lastCommit')
    equal('clean repo shows its last commit', lastCommit.files.map((f) => f.path), ['style.css'])
    equal('commit metadata included', lastCommit.commit?.subject, 'Restyle the title')

    const goFile = await get<FileDiff>('/api/repos/alpha/file?mode=worktree&path=main.go')
    equal('language detected', goFile.language, 'go')
    equal('status', goFile.status, 'modified')
    check('hunks returned', goFile.hunks.length === 1)
    check('old content for the split view', typeof goFile.oldContent === 'string')
    check('new content for the file view', typeof goFile.newContent === 'string')
    check('new content comes from the index in staged mode', goFile.newContent!.includes('os.Stdout'))

    const deleted = await get<FileDiff>('/api/repos/alpha/file?mode=worktree&path=README.md')
    check('deleted file marked', deleted.isDeleted)
    equal('deleted file has no new side', deleted.newContent, null)
    check('deleted file keeps its old content', deleted.oldContent?.startsWith('# Alpha') === true)

    const untracked = await get<FileDiff>('/api/repos/alpha/file?mode=worktree&path=untracked.py')
    check('untracked file treated as new', untracked.isNew)
    equal('untracked additions', untracked.additions, 2)
    equal('untracked hunk count', untracked.hunks.length, 1)

    const renamed = await get<FileDiff>(
      '/api/repos/alpha/file?mode=worktree&path=newname.py&oldPath=oldname.py',
    )
    equal('rename reported', renamed.status, 'renamed')
    equal('rename old path echoed', renamed.oldPath, 'oldname.py')

    const binary = await get<FileDiff>('/api/repos/alpha/file?mode=worktree&path=blob.bin')
    check('binary file flagged', binary.binary)
    equal('binary file has no hunks', binary.hunks.length, 0)

    const long = await get<FileDiff>('/api/repos/alpha/file?mode=worktree&path=long.ts')
    equal('single hunk far from the top', long.hunks.length, 1)
    check('leading context is collapsible', long.hunks[0].newStart > 20)
    equal('full new side available for expansion', long.newContent?.split('\n').length, 121)

    const errors = await Promise.all([
      fetch(`${base}/api/repos/alpha/file?mode=worktree&path=../beta/style.css`),
      fetch(`${base}/api/repos/alpha/file?mode=worktree&path=/etc/passwd`),
      fetch(`${base}/api/repos/alpha/changes?mode=nonsense`),
      fetch(`${base}/api/repos/ghost/changes?mode=worktree`),
      fetch(`${base}/api/nope`),
    ])
    equal('bad input rejected', errors.map((r) => r.status), [400, 400, 400, 404, 404])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
