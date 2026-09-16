import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Inside the project so `packages: 'external'` resolves from node_modules.
const outDir = path.join(rootDir, 'node_modules/.cache/ws-reviewer-tests')
mkdirSync(outDir, { recursive: true })
const outfile = path.join(outDir, 'run.mjs')

// Bundle the TSX suite; react resolves from node_modules at run time.
await build({
  entryPoints: [path.join(rootDir, 'tests/run.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  jsx: 'automatic',
  packages: 'external',
  logLevel: 'warning',
})

const child = spawn(process.execPath, [outfile], { cwd: rootDir, stdio: 'inherit' })
child.on('exit', (code) => {
  rmSync(outDir, { recursive: true, force: true })
  process.exit(code ?? 1)
})
