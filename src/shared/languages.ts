/** Extension / filename -> Shiki language id. Unknown files fall back to 'text'. */
const BY_EXTENSION: Record<string, string> = {
  as: 'actionscript-3', bash: 'shellscript', bat: 'bat', c: 'c', cc: 'cpp', cfg: 'ini',
  clj: 'clojure', cmake: 'cmake', coffee: 'coffee', conf: 'ini', cpp: 'cpp', cs: 'csharp',
  css: 'css', csv: 'csv', cu: 'cuda-cpp', cxx: 'cpp', d: 'd', dart: 'dart', diff: 'diff',
  dockerfile: 'docker', edn: 'clojure', ejs: 'ejs', elm: 'elm', erb: 'erb', erl: 'erlang',
  ex: 'elixir', exs: 'elixir', fish: 'fish', fs: 'fsharp', gd: 'gdscript', gitignore: 'ini',
  gleam: 'gleam', glsl: 'glsl', go: 'go', gql: 'graphql', gradle: 'groovy', graphql: 'graphql',
  groovy: 'groovy', h: 'c', handlebars: 'handlebars', hbs: 'handlebars', hcl: 'hcl',
  hpp: 'cpp', hs: 'haskell', htm: 'html', html: 'html', hxx: 'cpp', ini: 'ini', java: 'java',
  jl: 'julia', js: 'javascript', json: 'json', json5: 'json5', jsonc: 'jsonc', jsonl: 'json',
  jsx: 'jsx', kt: 'kotlin', kts: 'kotlin', less: 'less', lua: 'lua', m: 'objective-c',
  md: 'markdown', mdx: 'mdx', mjs: 'javascript', mm: 'objective-cpp', mts: 'typescript',
  cjs: 'javascript', cts: 'typescript', nim: 'nim', nix: 'nix', patch: 'diff', pl: 'perl',
  php: 'php', pp: 'puppet', prisma: 'prisma', proto: 'proto', ps1: 'powershell', py: 'python',
  pyi: 'python', r: 'r', rb: 'ruby', re: 'reason', rs: 'rust', s: 'asm', sass: 'sass',
  scala: 'scala', scm: 'scheme', scss: 'scss', sh: 'shellscript', sol: 'solidity',
  sql: 'sql', svelte: 'svelte', svg: 'xml', swift: 'swift', tex: 'latex', tf: 'terraform',
  tfvars: 'terraform', toml: 'toml', ts: 'typescript', tsv: 'tsv', tsx: 'tsx', txt: 'text',
  v: 'v', vb: 'vb', vue: 'vue', wat: 'wasm', xml: 'xml', yaml: 'yaml', yml: 'yaml',
  zig: 'zig', zsh: 'shellscript',
}

const BY_FILENAME: Record<string, string> = {
  '.bashrc': 'shellscript', '.dockerignore': 'ini', '.editorconfig': 'ini', '.env': 'dotenv',
  '.gitattributes': 'ini', '.gitignore': 'ini', '.zshrc': 'shellscript',
  brewfile: 'ruby', cargo: 'toml', dockerfile: 'docker', gemfile: 'ruby', justfile: 'make',
  makefile: 'make', rakefile: 'ruby', 'go.mod': 'go-module', 'go.sum': 'text',
  'go.work': 'go-module', 'cmakelists.txt': 'cmake',
}

export function languageForPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath
  const lower = base.toLowerCase()
  const byName = BY_FILENAME[lower]
  if (byName) return byName
  if (lower.startsWith('dockerfile')) return 'docker'
  if (lower.startsWith('makefile')) return 'make'
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return 'text'
  let ext = lower.slice(dot + 1)
  // `foo.pb.go`, `foo.d.ts` etc. still resolve through the final extension.
  if (ext === 'in' || ext === 'tmpl' || ext === 'template') {
    const inner = lower.slice(0, dot)
    const innerDot = inner.lastIndexOf('.')
    if (innerDot > 0) ext = inner.slice(innerDot + 1)
  }
  return BY_EXTENSION[ext] ?? 'text'
}
