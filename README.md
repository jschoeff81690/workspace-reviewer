# ws-reviewer

A local diff explorer for a workspace of related git repos. Run it in a
directory that contains several checkouts and it serves a localhost page with a
repo/file tree on the left and a PR-style diff viewer on the right.

```
ws-reviewer                # in /Users/you/workplace/sessions
```

- Every git work tree directly below the current directory becomes a repo in the
  left pane, with an indicator: hollow for clean, amber for unstaged/untracked
  work, green for staged-only, red for conflicts or errors.
- Repos with **staged or unstaged changes open on those changes** (`HEAD` vs the
  working tree, so staged and unstaged edits appear together). Repos with a
  clean tree **open on their most recent commit** instead.
- Expanding a repo also lists its **commits**, marking the ones that are ahead
  of its base branch. Review them **one at a time**, or take the whole stack
  **as a single diff against the base** — the aggregate comes from the merge
  base, so commits the base picked up after you branched stay out of it.
- Expanding a repo lists its changed files as a collapsed tree; picking one
  loads the diff. Expanding a repo also opens its first changed file, so the
  right pane fills in immediately.
- Each file can be viewed three ways, with syntax highlighting in all of them:
  **Inline** (`git diff` layout), **Split** (old left, new right, paired lines
  and intra-line word marks), and **File** (the whole file as it stands, with
  changed lines flagged in the gutter).
- The page updates itself when the repos change on disk — edits, `git add`,
  commits, branch switches. No refresh, and it is not a dev-only feature.

## Install

```sh
cd ws-reviewer
npm install
npm run build
```

That produces a self-contained `dist/`: the server bundles to a single
dependency-free file, and the client is static assets. `bin/ws-reviewer.mjs` is
the executable.

To get a `ws-reviewer` command on your `PATH`, pick one:

```sh
npm link                                             # global symlink via npm
ln -s "$PWD/bin/ws-reviewer.mjs" ~/bin/ws-reviewer # if ~/bin is on your PATH
alias ws-reviewer="node $PWD/bin/ws-reviewer.mjs"  # shell alias
```

Requires Node 20+ and `git` on the `PATH`. Nothing leaves the machine: the
server binds `127.0.0.1` and only ever reads from git.

## Usage

```
ws-reviewer [directory] [options]

  -p, --port <n>     Port to listen on (default 4300, tries the next free one)
  -d, --depth <n>    How deep to search for repos below the directory (default 1)
  -b, --base <ref>   Base branch for the "Branch" comparison (default: the
                     branch's upstream, else origin/HEAD, else main/master)
      --poll <ms>    Change-poll interval in ms (default 4000, or 1500 with --no-watch)
      --host <addr>  Interface to bind (default 127.0.0.1)
      --no-open      Do not open a browser
      --no-watch     Disable filesystem watching (poll only)
      --api-only     Serve only the API, for use with the Vite dev server
  -v, --version      Print the version
  -h, --help         Print this help
```

`--depth 2` picks up repos nested one directory further down. `--poll 10000`
lowers idle cost on a large workspace; filesystem events still give immediate
updates. `--base origin/develop` overrides base detection for every repo.

### Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | next / previous changed file |
| `1` / `2` / `3` | inline / split / file view |
| `w` | toggle line wrapping |
| `/` | focus the filter |
| `r` | refresh now |

### Comparisons

Each repo has its own comparison, chosen with the chips under its name. Only the
ones that apply are offered:

| Mode | Compares |
| --- | --- |
| Working tree | `HEAD` vs the working tree — staged **and** unstaged, plus untracked files |
| Staged | `HEAD` vs the index (`git diff --cached`) |
| Unstaged | the index vs the working tree (`git diff`), plus untracked files |
| Branch | the merge base vs `HEAD` — every commit on the branch as one diff |
| Last commit | the parent of `HEAD` vs `HEAD` |
| a commit | that commit vs its first parent, picked from the commit list |

Untracked files are shown as all-addition diffs. A wholly untracked directory is
expanded into its files (up to 200, then it stays collapsed as one row).

### The base branch

"Branch" needs to know what the work is a branch *of*. That is resolved once per
repo, in this order:

1. `--base <ref>`, if given
2. the branch's upstream (`@{upstream}`)
3. `origin/HEAD` — what the remote itself calls its default branch
4. the first of `origin/main`, `origin/master`, `upstream/main`,
   `upstream/master`, `main`, `master`, `develop` that exists

The branch you are on is never its own base, so a repo sitting on `main` with no
remote simply has no base, and the Branch comparison is not offered.

The aggregate diff runs from the **merge base**, which is what `git diff
base...HEAD` means. If the base gained commits after you branched, those are not
yours and do not appear. Switching between commits keeps you on the same file
whenever the new comparison also touches it.

## How it works

- **Server** (`src/server`): spawns `git`, parses its porcelain output, and
  serves JSON over `node:http` with no runtime dependencies. One
  `git status --porcelain=v2 -b -z` per repo yields the file list, branch,
  upstream, divergence and `HEAD` sha together; git processes are the dominant
  cost, so that call is shared between the change watcher and the API, and the
  head commit, the resolved base and per-sha commit metadata are all cached so a
  workspace refresh normally costs no git processes at all.
- **Refs from the browser** are validated against a ref-name character set and
  resolved through `rev-parse` before they reach any other git argument, so a
  crafted `?ref=` cannot turn into a git option.
- **Live updates**: recursive filesystem watches trigger an immediate re-check,
  a periodic poll backstops them, and changes reach the browser over
  server-sent events. The client refetches only what changed, and reloads
  itself if the server restarts (so a rebuild lands without a manual refresh).
- **Client** (`src/client`): React + Vite. Diffs are parsed into a shared row
  model that both the inline and split views render, which is also what makes
  the collapsed-context bands expandable — the server sends the full text of
  both sides, so unchanged regions can be revealed without another request.
- **Highlighting**: Shiki tokenizes each side of the file *whole*, then lines
  are rendered from those tokens. Tokenizing per line would miscolour anything
  spanning lines (block comments, template strings). Grammars load on demand, so
  only the languages you look at are ever fetched.
- **Word-level marks**: removed and added lines are paired within a hunk and
  diffed by word; if more than three quarters of the line changed the marks are
  dropped as noise.

### Limits

Files above 4 MB or 40,000 lines are diffed but their full text is not sent, so
the split and file views and context expansion are unavailable for them.
Highlighting is skipped above 20,000 lines. Very large diffs render in chunks
with a "render more rows" control. Binary files report as binary rather than
rendering.

## Development

```sh
npm run dev          # API on 4300 + Vite with HMR on 4301
npm run dev ../..    # point the dev API at a different workspace
npm test             # 241 assertions: git parsing, row model, API, rendering
npm run typecheck
```

`npm test` builds a throwaway workspace — staged, unstaged, untracked, renamed,
deleted and binary files in one repo; a clean repo with history; and a third
whose branch carries three commits over a base that has since moved on — then
runs the real API against it and renders the real components with
`react-dom/server`.
