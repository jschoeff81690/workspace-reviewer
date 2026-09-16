import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = process.argv[2] ?? path.resolve(rootDir, '..')
const apiPort = process.env.GIT_REVIEWER_API_PORT ?? '4300'

const children = []
const start = (label, command, args, env) => {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  })
  child.on('exit', (code) => {
    console.log(`[${label}] exited ${code}`)
    shutdown()
  })
  children.push(child)
}

const shutdown = () => {
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// API on 4300 (strict, so the Vite proxy target is stable), UI on 4301.
start('api', 'node', ['bin/ws-reviewer.mjs', workspace, '--api-only', '--port', apiPort, '--no-open'])
start('web', 'npx', ['vite'], { GIT_REVIEWER_API_PORT: apiPort })

console.log(`\ndev: API ${apiPort} against ${workspace}; UI http://localhost:4301\n`)
