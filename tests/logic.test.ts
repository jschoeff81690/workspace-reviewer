import { parseDiff, unquotePath, wholeFileHunk } from '../src/shared/parse-diff.ts'
import { languageForPath } from '../src/shared/languages.ts'
import { buildRows, expandGap, pairRows, splitLines } from '../src/client/lib/rows.ts'
import { buildTree, flattenFiles } from '../src/client/lib/tree.ts'
import { wordDiff } from '../src/client/lib/wordDiff.ts'
import { parseNameStatus, parseNumstat } from '../src/server/changes.ts'
import { parsePorcelainV2 } from '../src/server/status.ts'
import type { ChangedFile } from '../src/shared/types.ts'
import { check, equal, suite } from './assert.ts'

export function run(): void {
  suite('parse-diff')
  {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,5 +3,6 @@ function greet() {',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '+const c = 4',
      ' const d = 5',
      ' const e = 6',
      '',
    ].join('\n')
    const files = parseDiff(patch)
    equal('one file', files.length, 1)
    equal('paths', [files[0].oldPath, files[0].newPath], ['src/a.ts', 'src/a.ts'])
    equal('counts', [files[0].additions, files[0].deletions], [2, 1])
    equal('hunk heading', files[0].hunks[0].heading, 'function greet() {')
    const lines = files[0].hunks[0].lines
    equal('line numbers', lines.map((l) => [l.type, l.oldLine, l.newLine]), [
      ['context', 3, 3],
      ['del', 4, null],
      ['add', null, 4],
      ['add', null, 5],
      ['context', 5, 6],
      ['context', 6, 7],
    ])
  }

  {
    const patch = [
      'diff --git a/old name.txt b/new name.txt',
      'similarity index 88%',
      'rename from old name.txt',
      'rename to new name.txt',
      '--- a/old name.txt',
      '+++ b/new name.txt',
      '@@ -1 +1 @@',
      '-one',
      '+two',
    ].join('\n')
    const [file] = parseDiff(patch)
    check('rename detected', file.isRename)
    equal('rename paths', [file.oldPath, file.newPath], ['old name.txt', 'new name.txt'])
  }

  {
    const [file] = parseDiff(
      [
        'diff --git a/logo.png b/logo.png',
        'index 111..222 100644',
        'Binary files a/logo.png and b/logo.png differ',
      ].join('\n'),
    )
    check('binary detected', file.binary)
    equal('no hunks for binary', file.hunks.length, 0)
  }

  {
    const [file] = parseDiff(
      [
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,2 @@',
        '+alpha',
        '+beta',
        '\\ No newline at end of file',
      ].join('\n'),
    )
    check('new file', file.isNew)
    check('no-newline marker', file.hunks[0].lines[1].noNewline === true)
  }

  {
    const [file] = parseDiff(
      [
        'diff --git a/gone.txt b/gone.txt',
        'deleted file mode 100644',
        '--- a/gone.txt',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-alpha',
        '-beta',
      ].join('\n'),
    )
    check('deleted file', file.isDeleted)
    equal('deleted line numbers', file.hunks[0].lines.map((l) => l.oldLine), [1, 2])
  }

  {
    const files = parseDiff(
      [
        'diff --git a/one.txt b/one.txt',
        '--- a/one.txt',
        '+++ b/one.txt',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        'diff --git a/two.txt b/two.txt',
        '--- a/two.txt',
        '+++ b/two.txt',
        '@@ -1 +1 @@',
        '-c',
        '+d',
      ].join('\n'),
    )
    equal('multi-file patch', files.map((f) => f.newPath), ['one.txt', 'two.txt'])
  }

  equal('unquote octal path', unquotePath('"caf\\303\\251.txt"'), 'café.txt')
  equal('unquote tab escape', unquotePath('"a\\tb.txt"'), 'a\tb.txt')
  equal('plain path untouched', unquotePath('plain.txt'), 'plain.txt')

  {
    const hunk = wholeFileHunk('a\nb\n')
    equal('whole-file hunk lines', hunk?.lines.map((l) => l.newLine), [1, 2])
    equal('whole-file no trailing blank', hunk?.lines.length, 2)
    const noTrailing = wholeFileHunk('a\nb')
    check('missing newline flagged', noTrailing?.lines[1].noNewline === true)
    equal('empty file has no hunk', wholeFileHunk(''), null)
  }

  suite('languages')
  equal('go', languageForPath('service/matching/db.go'), 'go')
  equal('generated pb.go', languageForPath('api/token/v1/message.pb.go'), 'go')
  equal('proto', languageForPath('proto/message.proto'), 'proto')
  equal('tsx', languageForPath('src/App.tsx'), 'tsx')
  equal('dockerfile', languageForPath('deploy/Dockerfile'), 'docker')
  equal('makefile', languageForPath('Makefile'), 'make')
  equal('go.mod', languageForPath('go.mod'), 'go-module')
  equal('unknown', languageForPath('releases/v1.39.0'), 'text')
  equal('no extension', languageForPath('LICENSE'), 'text')

  suite('git output parsing')
  {
    const status = parsePorcelainV2(
      [
        '# branch.oid abc123',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -1',
        '1 .M N... 100644 100644 100644 aaa bbb a.txt',
        '1 M. N... 100644 100644 100644 aaa bbb b.txt',
        '? c.txt',
        'u UU N... 100644 100644 100644 100644 aaa bbb ccc d.txt',
        '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt',
        'old.txt',
        '1 .M N... 100644 100644 100644 aaa bbb dir with spaces/e.txt',
      ]
        .map((line) => `${line}\0`)
        .join(''),
    )
    equal('branch header', [status.branch.branch, status.branch.upstream], ['main', 'origin/main'])
    equal('head sha', status.branch.oid, 'abc123')
    equal('ahead/behind', [status.branch.ahead, status.branch.behind], [2, 1])
    equal('counts', status.counts, { staged: 2, unstaged: 2, untracked: 1, conflicted: 1 })
    equal('untracked list', status.untracked.map((entry) => entry.path), ['c.txt'])
    equal('rename original', status.byPath.get('new.txt')?.origPath, 'old.txt')
    equal('unmodified column normalized', status.byPath.get('a.txt')?.x, ' ')
    check('path with spaces kept whole', status.byPath.has('dir with spaces/e.txt'))
  }

  {
    const detached = parsePorcelainV2('# branch.oid abc\0# branch.head (detached)\0')
    check('detached head', detached.branch.detached && detached.branch.branch === null)
    const fresh = parsePorcelainV2('# branch.oid (initial)\0# branch.head main\0')
    equal('empty repo has no oid', fresh.branch.oid, null)
  }
  {
    const entries = parseNumstat('12\t3\ta.txt\0-\t-\tlogo.png\x005\t1\t\0old.txt\0new.txt\0')
    equal('numstat normal', entries[0], {
      additions: 12,
      deletions: 3,
      binary: false,
      path: 'a.txt',
      oldPath: undefined,
    })
    check('numstat binary', entries[1].binary && entries[1].path === 'logo.png')
    equal('numstat rename', [entries[2].oldPath, entries[2].path], ['old.txt', 'new.txt'])
  }
  {
    const map = parseNameStatus('M\0a.txt\0R100\0old.txt\0new.txt\0A\0c.txt\0')
    equal('name-status modified', map.get('a.txt'), { code: 'M' })
    equal('name-status rename', map.get('new.txt'), { code: 'R100', oldPath: 'old.txt' })
    equal('name-status added', map.get('c.txt'), { code: 'A' })
  }

  suite('row model')
  {
    const hunks = [
      {
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 4,
        heading: 'func a()',
        lines: [
          { type: 'context' as const, oldLine: 10, newLine: 10, content: 'ten' },
          { type: 'del' as const, oldLine: 11, newLine: null, content: 'old eleven' },
          { type: 'add' as const, oldLine: null, newLine: 11, content: 'new eleven' },
          { type: 'add' as const, oldLine: null, newLine: 12, content: 'extra' },
          { type: 'context' as const, oldLine: 12, newLine: 13, content: 'twelve' },
        ],
      },
      {
        oldStart: 40,
        oldLines: 2,
        newStart: 41,
        newLines: 2,
        heading: 'func b()',
        lines: [
          { type: 'context' as const, oldLine: 40, newLine: 41, content: 'forty' },
          { type: 'del' as const, oldLine: 41, newLine: null, content: 'gone' },
          { type: 'add' as const, oldLine: null, newLine: 42, content: 'added' },
        ],
      },
    ]
    const newLines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`)

    const collapsed = buildRows({ hunks, expand: {}, newLines })
    const gaps = collapsed.filter((row) => row.kind === 'gap')
    equal('three gaps (lead, middle, trail)', gaps.length, 3)
    equal('lead gap size', gaps[0].kind === 'gap' ? gaps[0].remaining : -1, 9)
    equal('middle gap size', gaps[1].kind === 'gap' ? gaps[1].remaining : -1, 27)
    equal('trailing gap size', gaps[2].kind === 'gap' ? gaps[2].remaining : -1, 18)

    const middle = gaps[1]
    const expandedDown = buildRows({
      hunks,
      expand: middle.kind === 'gap' ? expandGap({}, middle, 'down') : {},
      newLines,
    })
    const revealed = expandedDown.filter(
      (row) => row.kind === 'line' && row.line.type === 'context' && row.line.newLine! > 13 && row.line.newLine! < 41,
    )
    equal('down expansion reveals 20 lines', revealed.length, 20)
    equal(
      'revealed line numbering starts after the hunk',
      revealed[0].kind === 'line' ? [revealed[0].line.newLine, revealed[0].line.oldLine] : [],
      [14, 13],
    )
    equal(
      'revealed content matches the file',
      revealed[0].kind === 'line' ? revealed[0].line.content : '',
      'line 14',
    )

    const all = buildRows({
      hunks,
      expand: middle.kind === 'gap' ? expandGap({}, middle, 'all') : {},
      newLines,
    })
    equal('expand all removes that gap', all.filter((r) => r.kind === 'gap').length, 2)

    const upExpanded = buildRows({
      hunks,
      expand: middle.kind === 'gap' ? expandGap({}, middle, 'up') : {},
      newLines,
    })
    const upRows = upExpanded.filter(
      (row) => row.kind === 'line' && row.line.type === 'context' && row.line.newLine! > 13 && row.line.newLine! < 41,
    )
    const lastUpRow = upRows.at(-1)
    equal(
      'up expansion ends just before the next hunk',
      lastUpRow?.kind === 'line' ? lastUpRow.line.newLine : 0,
      40,
    )

    const noContent = buildRows({ hunks, expand: {}, newLines: null })
    const noContentGaps = noContent.filter((row) => row.kind === 'gap')
    equal('without content: no trailing gap', noContentGaps.length, 2)
    check('without content: expansion disabled', noContentGaps.every((g) => g.kind === 'gap' && !g.canExpand))

    const { splitRows, wordRanges } = pairRows(collapsed)
    const pairs = splitRows.filter((row) => row.kind === 'pair')
    const replaced = pairs.find(
      (row) => row.kind === 'pair' && row.left?.line.content === 'old eleven',
    )
    check('del paired with add', replaced?.kind === 'pair' && replaced.right?.line.content === 'new eleven')
    const orphan = pairs.find((row) => row.kind === 'pair' && row.right?.line.content === 'extra')
    check('unmatched add has empty left', orphan?.kind === 'pair' && orphan.left === null)
    check('word marks recorded for the pair', wordRanges.size >= 2)
  }

  {
    // Pure-deletion hunk: newLines is 0, so the following gap must not shift.
    const hunks = [
      {
        oldStart: 5,
        oldLines: 2,
        newStart: 4,
        newLines: 0,
        heading: '',
        lines: [
          { type: 'del' as const, oldLine: 5, newLine: null, content: 'a' },
          { type: 'del' as const, oldLine: 6, newLine: null, content: 'b' },
        ],
      },
    ]
    const newLines = Array.from({ length: 10 }, (_, i) => `l${i + 1}`)
    const rows = buildRows({ hunks, expand: { 1: { top: 100, bottom: 0 } }, newLines })
    const after = rows.filter((row) => row.kind === 'line' && row.line.type === 'context')
    equal(
      'deletion-only hunk keeps old/new offset',
      after.map((r) => (r.kind === 'line' ? [r.line.newLine, r.line.oldLine] : [])).slice(0, 2),
      [[5, 7], [6, 8]],
    )
  }

  equal('splitLines drops the trailing newline', splitLines('a\nb\n'), ['a', 'b'])
  equal('splitLines keeps interior blanks', splitLines('a\n\nb'), ['a', '', 'b'])
  equal('splitLines of empty file', splitLines(''), [])
  equal('splitLines of null', splitLines(null), null)

  suite('word diff')
  {
    const marks = wordDiff('const b = 2', 'const b = 3')
    check('single token changed', !!marks && marks.left.length === 1 && marks.right.length === 1)
    equal('left range covers "2"', marks?.left[0], [10, 11])
    check('wholly different lines skipped', wordDiff('aaa bbb ccc', 'zzz yyy xxx') === null)
    check('identical lines skipped', wordDiff('same', 'same') === null)
  }

  suite('file tree')
  {
    const files: ChangedFile[] = [
      'service/history/workflow/session.go',
      'service/history/workflow/session_test.go',
      'service/matching/db.go',
      'go.mod',
      'api/token/v1/message.pb.go',
    ].map((path) => ({
      path,
      status: 'modified',
      additions: 1,
      deletions: 0,
      binary: false,
      staged: false,
      unstaged: true,
    }))

    const tree = buildTree(files)
    equal(
      'top level: dirs first then files',
      tree.map((node) => node.name),
      ['api/token/v1', 'service', 'go.mod'],
    )
    const api = tree[0]
    check('single-child chain collapsed', api.kind === 'dir' && api.children.length === 1)
    const service = tree[1]
    equal(
      'shared parent not collapsed',
      service.kind === 'dir' ? service.children.map((c) => c.name) : [],
      ['history/workflow', 'matching'],
    )
    equal('dir file counts', service.kind === 'dir' ? service.fileCount : 0, 3)
    equal(
      'flatten follows display order',
      flattenFiles(tree).map((f) => f.path),
      [
        'api/token/v1/message.pb.go',
        'service/history/workflow/session.go',
        'service/history/workflow/session_test.go',
        'service/matching/db.go',
        'go.mod',
      ],
    )
  }
}
