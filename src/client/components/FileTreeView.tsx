import type { ChangedFile } from '../../shared/types.ts'
import type { TreeNode } from '../lib/tree.ts'

interface Props {
  nodes: TreeNode[]
  repo: string
  depth: number
  selectedPath: string | null
  collapsed: Set<string>
  onToggleDir: (key: string) => void
  onSelect: (file: ChangedFile) => void
}

const STATUS_LETTER: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflicted: '!',
  unknown: '?',
}

/** The changed-file tree for one repo, with single-child directories collapsed. */
export function FileTreeView({
  nodes,
  repo,
  depth,
  selectedPath,
  collapsed,
  onToggleDir,
  onSelect,
}: Props) {
  return (
    <div className="tree">
      {nodes.map((node) => {
        const indent = 14 + depth * 12
        if (node.kind === 'dir') {
          const key = `${repo}:${node.path}`
          const isCollapsed = collapsed.has(key)
          return (
            <div key={key}>
              <button
                className="tree-row dir"
                style={{ paddingLeft: indent }}
                onClick={() => onToggleDir(key)}
                title={node.path}
              >
                <span className={isCollapsed ? 'chev' : 'chev open'}>{'▶'}</span>
                <span className="tree-name">{node.name}</span>
                <span className="stat">{node.fileCount}</span>
              </button>
              {!isCollapsed && (
                <FileTreeView
                  nodes={node.children}
                  repo={repo}
                  depth={depth + 1}
                  selectedPath={selectedPath}
                  collapsed={collapsed}
                  onToggleDir={onToggleDir}
                  onSelect={onSelect}
                />
              )}
            </div>
          )
        }

        const file = node.file
        const selected = selectedPath === file.path
        return (
          <button
            key={`${repo}:${file.path}`}
            className={selected ? 'tree-row selected' : 'tree-row'}
            style={{ paddingLeft: indent + 14 }}
            onClick={() => onSelect(file)}
            title={`${file.path}${file.oldPath ? `  (was ${file.oldPath})` : ''}`}
          >
            <span className={`status-badge ${file.status}`}>{STATUS_LETTER[file.status]}</span>
            <span className="tree-name">{node.name}</span>
            {(file.staged || file.unstaged) && (
              <span
                className="stage-dots"
                title={[file.staged ? 'staged' : null, file.unstaged ? 'unstaged' : null]
                  .filter(Boolean)
                  .join(' + ')}
              >
                {file.staged && <i className="s" />}
                {file.unstaged && <i className="u" />}
              </span>
            )}
            <span className="stat">
              {file.binary ? (
                'bin'
              ) : file.collapsedDir ? (
                `${file.fileCount} files`
              ) : (
                <>
                  <span className="plus">+{file.additions}</span>{' '}
                  <span className="minus">-{file.deletions}</span>
                </>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
