import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(rootDir, 'src/server/index.ts')],
  outfile: path.join(rootDir, 'dist/server/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  // The server only imports node builtins, so the bundle is dependency-free.
  external: ['node:*'],
})
