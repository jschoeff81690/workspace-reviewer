#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const built = path.resolve(here, '../dist/server/index.mjs')
const source = path.resolve(here, '../src/server/index.ts')

const entry = existsSync(built) ? built : source
if (entry === source && !existsSync(source)) {
  console.error('git-reviewer: no build found and no sources to fall back to')
  process.exit(1)
}

const { run } = await import(entry)
await run()
