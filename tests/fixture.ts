import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SERVER_TS_V1 = `import { createServer } from 'node:http'

/** Tiny demo server. */
export function start(port: number): void {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, url: req.url }))
  })
  server.listen(port)
}
`

const SERVER_TS_V2 = `import { createServer } from 'node:http'

/** Tiny demo server. */
export function start(port: number, host = '127.0.0.1'): void {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, url: req.url, ts: Date.now() }))
  })
  server.listen(port, host)
}
`

const MAIN_GO_V1 = `package main

import "fmt"

func main() {
\tfmt.Println("hello")
}
`

const MAIN_GO_V2 = `package main

import (
\t"fmt"
\t"os"
)

func main() {
\tfmt.Fprintln(os.Stdout, "hello")
}
`

/** A long file, so context expansion has something to expand. */
function longFile(marker: string): string {
  const lines: string[] = []
  for (let i = 1; i <= 120; i++) {
    lines.push(i === 60 ? `const middle = '${marker}'` : `const line${i} = ${i}`)
  }
  return `${lines.join('\n')}\n`
}

export interface Fixture {
  root: string
  /** `alpha` has every interesting state; `beta` is clean with two commits. */
  alpha: string
  beta: string
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function init(dir: string): void {
  mkdirSync(dir, { recursive: true })
  git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q', '.'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
}

/** Build a throwaway workspace covering the states the UI has to handle. */
export function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'ws-reviewer-test-'))
  const alpha = path.join(root, 'alpha')
  const beta = path.join(root, 'beta')

  init(alpha)
  mkdirSync(path.join(alpha, 'src'), { recursive: true })
  writeFileSync(path.join(alpha, 'src/server.ts'), SERVER_TS_V1)
  writeFileSync(path.join(alpha, 'main.go'), MAIN_GO_V1)
  writeFileSync(path.join(alpha, 'long.ts'), longFile('before'))
  writeFileSync(path.join(alpha, 'README.md'), '# Alpha\n\nFixture repo.\n')
  writeFileSync(path.join(alpha, 'oldname.py'), 'value = 1\n')
  git(alpha, ['add', '-A'])
  git(alpha, ['commit', '-qm', 'Initial commit'])

  // staged: main.go rewritten, oldname.py renamed
  writeFileSync(path.join(alpha, 'main.go'), MAIN_GO_V2)
  git(alpha, ['add', 'main.go'])
  git(alpha, ['mv', 'oldname.py', 'newname.py'])
  // unstaged: server.ts edited, long.ts edited far from the top, README deleted
  writeFileSync(path.join(alpha, 'src/server.ts'), SERVER_TS_V2)
  writeFileSync(path.join(alpha, 'long.ts'), longFile('after'))
  rmSync(path.join(alpha, 'README.md'))
  // untracked: a file, a directory, and a binary
  writeFileSync(path.join(alpha, 'untracked.py'), 'def hello():\n    return "world"\n')
  mkdirSync(path.join(alpha, 'newdir'), { recursive: true })
  writeFileSync(path.join(alpha, 'newdir/one.txt'), 'one\n')
  writeFileSync(path.join(alpha, 'newdir/two.txt'), 'two\n')
  writeFileSync(path.join(alpha, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255, 7]))

  init(beta)
  writeFileSync(path.join(beta, 'style.css'), 'body { color: red; }\n')
  git(beta, ['add', '-A'])
  git(beta, ['commit', '-qm', 'Add stylesheet'])
  writeFileSync(path.join(beta, 'style.css'), 'body { color: rebeccapurple; }\n.title { font-weight: 600; }\n')
  git(beta, ['commit', '-qam', 'Restyle the title'])

  return { root, alpha, beta }
}

export function removeFixture(fixture: Fixture): void {
  rmSync(fixture.root, { recursive: true, force: true })
}
