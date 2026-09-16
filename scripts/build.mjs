import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDir, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))))
    child.on('error', reject)
  })

await run('node', ['scripts/build-server.mjs'])
await run('npx', ['vite', 'build'])
console.log('\nBuilt dist/server/index.mjs and dist/client. Run `./bin/ws-reviewer.mjs` from any workspace.')
