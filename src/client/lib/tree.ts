import { compareNames } from '../../shared/sort.ts'
import type { ChangedFile } from '../../shared/types.ts'

export interface TreeFile {
  kind: 'file'
  name: string
  path: string
  file: ChangedFile
}

export interface TreeDir {
  kind: 'dir'
  /** Possibly a collapsed chain, e.g. `service/history/workflow`. */
  name: string
  path: string
  children: TreeNode[]
  fileCount: number
  additions: number
  deletions: number
}

export type TreeNode = TreeDir | TreeFile

interface MutableDir {
  dirs: Map<string, MutableDir>
  files: TreeFile[]
}

function emptyDir(): MutableDir {
  return { dirs: new Map(), files: [] }
}

/**
 * Build a directory tree from changed-file paths. Directory chains with a
 * single child directory are collapsed (`a/b/c`), the way PR file trees do it.
 */
export function buildTree(files: ChangedFile[]): TreeNode[] {
  const root = emptyDir()

  for (const file of files) {
    const segments = file.path.replace(/\/$/, '').split('/')
    const name = segments.pop() ?? file.path
    let dir = root
    for (const segment of segments) {
      let next = dir.dirs.get(segment)
      if (!next) {
        next = emptyDir()
        dir.dirs.set(segment, next)
      }
      dir = next
    }
    dir.files.push({ kind: 'file', name, path: file.path, file })
  }

  return materialize(root, '')
}

function materialize(dir: MutableDir, prefix: string): TreeNode[] {
  const dirs: TreeDir[] = []
  for (const [name, child] of dir.dirs) {
    let dirName = name
    let current = child
    let path = prefix ? `${prefix}/${name}` : name
    // Collapse `a/ -> b/ -> file` chains into a single `a/b` row.
    while (current.files.length === 0 && current.dirs.size === 1) {
      const [onlyName, onlyChild] = [...current.dirs.entries()][0]
      dirName = `${dirName}/${onlyName}`
      path = `${path}/${onlyName}`
      current = onlyChild
    }
    const children = materialize(current, path)
    dirs.push({
      kind: 'dir',
      name: dirName,
      path,
      children,
      fileCount: countFiles(children),
      additions: sum(children, (n) => (n.kind === 'file' ? n.file.additions : n.additions)),
      deletions: sum(children, (n) => (n.kind === 'file' ? n.file.deletions : n.deletions)),
    })
  }

  dirs.sort((a, b) => compareNames(a.name, b.name))
  const files = [...dir.files].sort((a, b) => compareNames(a.name, b.name))
  return [...dirs, ...files]
}

function countFiles(nodes: TreeNode[]): number {
  return sum(nodes, (node) => (node.kind === 'file' ? 1 : node.fileCount))
}

function sum(nodes: TreeNode[], pick: (node: TreeNode) => number): number {
  let total = 0
  for (const node of nodes) total += pick(node)
  return total
}

/** Flatten to the file order the tree displays, for j/k navigation. */
export function flattenFiles(nodes: TreeNode[]): ChangedFile[] {
  const out: ChangedFile[] = []
  const walk = (list: TreeNode[]): void => {
    for (const node of list) {
      if (node.kind === 'file') out.push(node.file)
      else walk(node.children)
    }
  }
  walk(nodes)
  return out
}
