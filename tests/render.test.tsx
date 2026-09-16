import { renderToStaticMarkup } from 'react-dom/server'
import { DiffPane } from '../src/client/components/DiffPane.tsx'
import { FileTreeView } from '../src/client/components/FileTreeView.tsx'
import { InlineDiff } from '../src/client/components/InlineDiff.tsx'
import { Sidebar } from '../src/client/components/Sidebar.tsx'
import { SplitDiff } from '../src/client/components/SplitDiff.tsx'
import { buildRows, pairRows, splitLines } from '../src/client/lib/rows.ts'
import { buildTree } from '../src/client/lib/tree.ts'
import { listChanges } from '../src/server/changes.ts'
import { getFileDiff } from '../src/server/filediff.ts'
import { summarizeRepo } from '../src/server/workspace.ts'
import { check, equal, suite } from './assert.ts'
import type { Fixture } from './fixture.ts'

const count = (markup: string, needle: string): number => markup.split(needle).length - 1

export async function run(fixture: Fixture): Promise<void> {
  suite('rendering')

  const file = await getFileDiff({
    repoName: 'alpha',
    repoPath: fixture.alpha,
    mode: 'worktree',
    filePath: 'src/server.ts',
  })
  const rows = buildRows({ hunks: file.hunks, expand: {}, newLines: splitLines(file.newContent) })
  const paired = pairRows(rows)

  const inline = renderToStaticMarkup(
    <InlineDiff
      rows={rows}
      wordRanges={paired.wordRanges}
      oldTokens={null}
      newTokens={null}
      limit={5000}
      onExpand={() => {}}
      onRaiseLimit={() => {}}
    />,
  )
  check('inline view renders a diff table', inline.includes('class="diff inline"'))
  equal('inline row count matches the row model', count(inline, '<tr'), rows.length)
  check('inline marks additions', inline.includes('class="add"'))
  check('inline marks deletions', inline.includes('class="del"'))
  check('inline shows the changed code', inline.includes('ts: Date.now()'))
  check('inline marks changed words inside a line', inline.includes('<mark class="w'))

  const split = renderToStaticMarkup(
    <SplitDiff
      rows={paired.splitRows}
      wordRanges={paired.wordRanges}
      oldTokens={null}
      newTokens={null}
      limit={5000}
      onExpand={() => {}}
      onRaiseLimit={() => {}}
      wrap
    />,
  )
  check('split view renders', split.includes('class="diff split fixed"'))
  equal('split has four cells per row', count(split, '<td') / count(split, '<tr'), 4)
  check('split keeps the old side', split.includes('class="content del"'))
  check('split keeps the new side', split.includes('class="content add"'))

  // An unbalanced run (one import line becoming a block) leaves one side empty.
  const goDiff = await getFileDiff({
    repoName: 'alpha',
    repoPath: fixture.alpha,
    mode: 'worktree',
    filePath: 'main.go',
  })
  const goPaired = pairRows(
    buildRows({ hunks: goDiff.hunks, expand: {}, newLines: splitLines(goDiff.newContent) }),
  )
  const goSplit = renderToStaticMarkup(
    <SplitDiff
      rows={goPaired.splitRows}
      wordRanges={goPaired.wordRanges}
      oldTokens={null}
      newTokens={null}
      limit={5000}
      onExpand={() => {}}
      onRaiseLimit={() => {}}
      wrap
    />,
  )
  check('split fills missing sides', goSplit.includes('class="content empty"'))
  equal(
    'split pairs every row, padding the shorter side',
    count(goSplit, '<td') / count(goSplit, '<tr'),
    4,
  )

  // A file whose change sits far from the top must offer a collapsed band.
  const long = await getFileDiff({
    repoName: 'alpha',
    repoPath: fixture.alpha,
    mode: 'worktree',
    filePath: 'long.ts',
  })
  const longRows = buildRows({
    hunks: long.hunks,
    expand: {},
    newLines: splitLines(long.newContent),
  })
  const longMarkup = renderToStaticMarkup(
    <InlineDiff
      rows={longRows}
      wordRanges={new Map()}
      oldTokens={null}
      newTokens={null}
      limit={5000}
      onExpand={() => {}}
      onRaiseLimit={() => {}}
    />,
  )
  check('collapsed context band rendered', longMarkup.includes('class="gap"'))
  check('expand controls offered', longMarkup.includes('expand all'))

  suite('rendering: panes')
  const paneModes = ['inline', 'split', 'file'] as const
  for (const view of paneModes) {
    const markup = renderToStaticMarkup(
      <DiffPane
        file={file}
        mode="worktree"
        loading={false}
        error={null}
        view={view}
        wrap
        theme="dark"
        onView={() => {}}
        onWrap={() => {}}
        onNav={() => {}}
        navCount={3}
        navIndex={0}
      />,
    )
    check(`${view} pane renders`, markup.includes('class="file-head"'))
    check(`${view} pane names the file`, markup.includes('server.ts'))
    check(`${view} pane offers all three views`, count(markup, 'aria-pressed') >= 3)
  }

  const filePane = renderToStaticMarkup(
    <DiffPane
      file={file}
      mode="worktree"
      loading={false}
      error={null}
      view="file"
      wrap
      theme="dark"
      onView={() => {}}
      onWrap={() => {}}
      onNav={() => {}}
      navCount={1}
      navIndex={0}
    />,
  )
  const fileLines = splitLines(file.newContent) ?? []
  equal('file view renders every line', count(filePane, '<tr'), fileLines.length)
  check('file view flags changed lines', filePane.includes('class="changed-marker"'))

  const binary = await getFileDiff({
    repoName: 'alpha',
    repoPath: fixture.alpha,
    mode: 'worktree',
    filePath: 'blob.bin',
  })
  const binaryPane = renderToStaticMarkup(
    <DiffPane
      file={binary}
      mode="worktree"
      loading={false}
      error={null}
      view="inline"
      wrap
      theme="dark"
      onView={() => {}}
      onWrap={() => {}}
      onNav={() => {}}
      navCount={1}
      navIndex={0}
    />,
  )
  check('binary file explained rather than rendered', binaryPane.includes('Binary file'))

  const deletedPane = renderToStaticMarkup(
    <DiffPane
      file={await getFileDiff({
        repoName: 'alpha',
        repoPath: fixture.alpha,
        mode: 'worktree',
        filePath: 'README.md',
      })}
      mode="worktree"
      loading={false}
      error={null}
      view="file"
      wrap
      theme="dark"
      onView={() => {}}
      onWrap={() => {}}
      onNav={() => {}}
      navCount={1}
      navIndex={0}
    />,
  )
  check('deleted file falls back to its old contents', deletedPane.includes('before deletion'))

  suite('rendering: sidebar')
  const changes = await listChanges('alpha', fixture.alpha, 'worktree')
  const tree = renderToStaticMarkup(
    <FileTreeView
      nodes={buildTree(changes.files)}
      repo="alpha"
      depth={0}
      selectedPath="main.go"
      collapsed={new Set()}
      onToggleDir={() => {}}
      onSelect={() => {}}
    />,
  )
  equal('one row per changed file plus directories', count(tree, '<button'), changes.files.length + 2)
  check('directory row rendered', tree.includes('class="tree-row dir"'))
  check('selection highlighted', tree.includes('class="tree-row selected"'))
  check('status badges rendered', tree.includes('class="status-badge untracked"'))
  check('staged/unstaged dots rendered', tree.includes('class="stage-dots"'))

  const alphaSummary = await summarizeRepo({ name: 'alpha', path: fixture.alpha })
  const betaSummary = await summarizeRepo({ name: 'beta', path: fixture.beta })
  const sidebar = renderToStaticMarkup(
    <Sidebar
      repos={[alphaSummary, betaSummary]}
      changes={{ 'alpha|worktree': changes }}
      changesError={{}}
      expanded={new Set(['alpha'])}
      collapsedDirs={new Set()}
      selection={{ repo: 'alpha', path: 'main.go' }}
      filter=""
      modeFor={(repo) => repo.defaultMode}
      onFilter={() => {}}
      onToggleRepo={() => {}}
      onSetMode={() => {}}
      onSelect={() => {}}
      onToggleDir={() => {}}
      filterRef={{ current: null }}
    />,
  )
  check('both repos listed', sidebar.includes('alpha') && sidebar.includes('beta'))
  check('dirty repo gets a filled indicator', sidebar.includes('state-dot dirty'))
  check('clean repo gets a hollow indicator', sidebar.includes('state-dot clean'))
  check('clean repo shows its commit subject', sidebar.includes('Restyle the title'))
  check('mode chips rendered for the expanded repo', sidebar.includes('class="mode-bar"'))
  equal('only the expanded repo contributes file rows', count(sidebar, 'status-badge'), changes.files.length)
  equal('only the expanded repo shows mode chips', count(sidebar, 'class="mode-bar"'), 1)
}
