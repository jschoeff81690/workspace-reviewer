import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangedFile,
  CompareMode,
  FileDiff,
  RepoChanges,
  RepoSummary,
  WorkspaceInfo,
} from '../shared/types.ts'
import { DiffPane } from './components/DiffPane.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { api } from './lib/api.ts'
import { warmHighlighter, type ThemeName } from './lib/highlight.ts'
import { useLive } from './lib/live.ts'
import { flattenFiles, buildTree } from './lib/tree.ts'
import { usePersisted } from './lib/usePersisted.ts'
import type { Selection, ViewMode } from './lib/uiTypes.ts'

const changesKey = (repo: string, mode: CompareMode): string => `${repo}|${mode}`

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [changes, setChanges] = useState<Record<string, RepoChanges | undefined>>({})
  const [changesError, setChangesError] = useState<Record<string, string | undefined>>({})
  const [file, setFile] = useState<FileDiff | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const [pendingSelect, setPendingSelect] = useState<string | null>(null)

  const [modeOverrides, setModeOverrides] = usePersisted<Record<string, CompareMode>>('modes', {})
  const [expandedList, setExpandedList] = usePersisted<string[]>('expanded', [])
  const [selection, setSelection] = usePersisted<Selection | null>('selection', null)
  const [view, setView] = usePersisted<ViewMode>('view', 'inline')
  const [wrap, setWrap] = usePersisted<boolean>('wrap', true)
  const [changedFirst, setChangedFirst] = usePersisted<boolean>('changedFirst', true)
  const [sidebarWidth, setSidebarWidth] = usePersisted<number>('sidebarWidth', 330)
  const [theme, setTheme] = usePersisted<ThemeName>('theme', systemTheme())

  const expanded = useMemo(() => new Set(expandedList), [expandedList])
  const filterRef = useRef<HTMLInputElement>(null)
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => warmHighlighter(), [])

  /* ------------------------------------------------------------ workspace */
  const loadWorkspace = useCallback(async () => {
    try {
      const next = await api.workspace()
      setWorkspace(next)
      setWorkspaceError(null)
      return next
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const modeFor = useCallback(
    (repo: RepoSummary): CompareMode => {
      const override = modeOverrides[repo.name]
      if (override && repo.availableModes.includes(override)) return override
      return repo.defaultMode
    },
    [modeOverrides],
  )

  const repos = useMemo(() => {
    const list = workspace?.repos ?? []
    if (!changedFirst) return list
    return [...list].sort((a, b) => {
      const weight = (repo: RepoSummary): number => (repo.error ? 0 : repo.dirty ? 1 : 2)
      return weight(a) - weight(b) || a.name.localeCompare(b.name)
    })
  }, [workspace, changedFirst])

  const repoByName = useMemo(
    () => new Map((workspace?.repos ?? []).map((repo) => [repo.name, repo])),
    [workspace],
  )

  /* -------------------------------------------------------------- changes */
  const loadChanges = useCallback(
    async (repoName: string, mode: CompareMode, force = false): Promise<RepoChanges | null> => {
      const key = changesKey(repoName, mode)
      if (!force && inFlight.current.has(key)) return null
      inFlight.current.add(key)
      try {
        const next = await api.changes(repoName, mode)
        setChanges((prev) => ({ ...prev, [key]: next }))
        setChangesError((prev) => ({ ...prev, [key]: undefined }))
        return next
      } catch (err) {
        setChangesError((prev) => ({
          ...prev,
          [key]: err instanceof Error ? err.message : String(err),
        }))
        return null
      } finally {
        inFlight.current.delete(key)
      }
    },
    [],
  )

  // Fetch the file list for every expanded repo that has not been loaded yet.
  useEffect(() => {
    for (const repo of workspace?.repos ?? []) {
      if (!expanded.has(repo.name)) continue
      const mode = modeFor(repo)
      const key = changesKey(repo.name, mode)
      if (changes[key] || changesError[key] || inFlight.current.has(key)) continue
      void loadChanges(repo.name, mode)
    }
  }, [workspace, expanded, modeFor, changes, changesError, loadChanges])

  /* -------------------------------------------------- selection lifecycle */
  const visibleFiles = useMemo((): ChangedFile[] => {
    if (!selection) return []
    const repo = repoByName.get(selection.repo)
    if (!repo) return []
    const current = changes[changesKey(repo.name, modeFor(repo))]
    if (!current) return []
    const needle = filter.trim().toLowerCase()
    const repoMatches = needle !== '' && repo.name.toLowerCase().includes(needle)
    const files =
      !needle || repoMatches
        ? current.files
        : current.files.filter((candidate) => candidate.path.toLowerCase().includes(needle))
    return flattenFiles(buildTree(files))
  }, [selection, repoByName, changes, modeFor, filter])

  // After expanding a repo, open its first file so the right pane fills in.
  useEffect(() => {
    if (!pendingSelect) return
    const repo = repoByName.get(pendingSelect)
    if (!repo) {
      setPendingSelect(null)
      return
    }
    const current = changes[changesKey(repo.name, modeFor(repo))]
    if (!current) return
    const first = flattenFiles(buildTree(current.files))[0]
    setPendingSelect(null)
    if (first) setSelection({ repo: repo.name, path: first.path, oldPath: first.oldPath })
  }, [pendingSelect, repoByName, changes, modeFor, setSelection])

  // First load with nothing remembered: open the first repo that has changes.
  const bootstrapped = useRef(false)
  useEffect(() => {
    if (bootstrapped.current || !workspace) return
    bootstrapped.current = true
    if (selection && repoByName.has(selection.repo)) return
    const target = workspace.repos.find((repo) => repo.dirty) ?? workspace.repos[0]
    if (!target) return
    setExpandedList((prev) => (prev.includes(target.name) ? prev : [...prev, target.name]))
    setPendingSelect(target.name)
  }, [workspace, selection, repoByName, setExpandedList, setSelection])

  // Drop a remembered selection whose repo has gone away.
  useEffect(() => {
    if (!workspace || !selection) return
    if (!repoByName.has(selection.repo)) setSelection(null)
  }, [workspace, selection, repoByName, setSelection])

  const selectionMode = useMemo((): CompareMode | null => {
    if (!selection) return null
    const repo = repoByName.get(selection.repo)
    return repo ? modeFor(repo) : null
  }, [selection, repoByName, modeFor])

  const loadFile = useCallback(
    async (target: Selection, mode: CompareMode, signal?: AbortSignal) => {
      setFileLoading(true)
      try {
        const next = await api.file(target.repo, mode, target.path, target.oldPath, signal)
        if (signal?.aborted) return
        setFile(next)
        setFileError(null)
      } catch (err) {
        if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
        setFile(null)
        setFileError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!signal?.aborted) setFileLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!selection || !selectionMode) {
      setFile(null)
      setFileError(null)
      return
    }
    const controller = new AbortController()
    void loadFile(selection, selectionMode, controller.signal)
    return () => controller.abort()
  }, [selection, selectionMode, loadFile])

  /* ----------------------------------------------------------------- live */
  const onServerChange = useCallback(
    (changedRepos: string[]) => {
      void loadWorkspace().then((next) => {
        const current = next ?? workspace
        for (const name of changedRepos) {
          const repo = current?.repos.find((candidate) => candidate.name === name)
          if (!repo) continue
          // Reload every comparison we already hold for this repo.
          for (const mode of repo.availableModes) {
            if (changes[changesKey(name, mode)]) void loadChanges(name, mode, true)
          }
          if (expanded.has(name)) void loadChanges(name, modeFor(repo), true)
        }
      })
      if (selection && selectionMode && changedRepos.includes(selection.repo)) {
        void loadFile(selection, selectionMode)
      }
    },
    [loadWorkspace, workspace, changes, expanded, modeFor, loadChanges, selection, selectionMode, loadFile],
  )

  const live = useLive(onServerChange)

  const refreshNow = useCallback(async () => {
    await api.refresh().catch(() => undefined)
    const next = await loadWorkspace()
    for (const repo of next?.repos ?? []) {
      if (expanded.has(repo.name)) void loadChanges(repo.name, modeFor(repo), true)
    }
    if (selection && selectionMode) void loadFile(selection, selectionMode)
  }, [loadWorkspace, expanded, modeFor, loadChanges, selection, selectionMode, loadFile])

  /* ------------------------------------------------------------- handlers */
  const toggleRepo = useCallback(
    (name: string) => {
      if (expanded.has(name)) {
        setExpandedList((prev) => prev.filter((candidate) => candidate !== name))
        return
      }
      setExpandedList((prev) => (prev.includes(name) ? prev : [...prev, name]))
      // Opening a repo also opens its first changed file.
      setPendingSelect(name)
    },
    [expanded, setExpandedList],
  )

  const setMode = useCallback(
    (repoName: string, mode: CompareMode) => {
      setModeOverrides((prev) => ({ ...prev, [repoName]: mode }))
      void loadChanges(repoName, mode, true)
      setPendingSelect(repoName)
    },
    [setModeOverrides, loadChanges],
  )

  const selectFile = useCallback(
    (repoName: string, target: ChangedFile) => {
      setSelection({ repo: repoName, path: target.path, oldPath: target.oldPath })
    },
    [setSelection],
  )

  const navIndex = useMemo(
    () => (selection ? visibleFiles.findIndex((candidate) => candidate.path === selection.path) : -1),
    [visibleFiles, selection],
  )

  const nav = useCallback(
    (delta: number) => {
      if (!selection || visibleFiles.length === 0) return
      const base = navIndex < 0 ? 0 : navIndex
      const next = visibleFiles[Math.min(Math.max(base + delta, 0), visibleFiles.length - 1)]
      if (next) setSelection({ repo: selection.repo, path: next.path, oldPath: next.oldPath })
    },
    [selection, visibleFiles, navIndex, setSelection],
  )

  const toggleDir = useCallback((key: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /* ------------------------------------------------------------ shortcuts */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if (event.key === 'Escape') {
        if (typing) (target as HTMLInputElement).blur()
        return
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return

      switch (event.key) {
        case 'j':
          nav(1)
          break
        case 'k':
          nav(-1)
          break
        case '1':
          setView('inline')
          break
        case '2':
          setView('split')
          break
        case '3':
          setView('file')
          break
        case 'w':
          setWrap((prev) => !prev)
          break
        case 'r':
          void refreshNow()
          break
        case '/':
          event.preventDefault()
          filterRef.current?.focus()
          filterRef.current?.select()
          break
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav, setView, setWrap, refreshNow])

  /* -------------------------------------------------------- sidebar width */
  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = sidebarWidth
      const onMove = (move: MouseEvent): void => {
        setSidebarWidth(Math.min(700, Math.max(220, startWidth + move.clientX - startX)))
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
      }
      document.body.style.cursor = 'col-resize'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [sidebarWidth, setSidebarWidth],
  )

  const dirtyCount = repos.filter((repo) => repo.dirty).length

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          git<span>-</span>reviewer
        </span>
        <span className="root-path" title={workspace?.root}>
          {workspace?.root ?? 'loading…'}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="counts">
          {repos.length} repos {'·'} {dirtyCount} changed
        </span>
        <span className="live" title={live.connected ? 'watching for changes' : 'reconnecting…'}>
          <i
            key={live.lastChangeAt ?? 0}
            className={live.connected ? 'dot on pulse' : 'dot'}
          />
          {live.connected ? 'live' : 'offline'}
        </span>
        <button
          className="btn"
          aria-pressed={changedFirst}
          title="Sort repos with changes first"
          onClick={() => setChangedFirst((prev) => !prev)}
        >
          {changedFirst ? 'changed first' : 'a–z'}
        </button>
        <button className="btn" title="Refresh now (r)" onClick={() => void refreshNow()}>
          refresh
        </button>
        <button
          className="btn icon"
          title="Toggle light / dark"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '◑' : '◐'}
        </button>
      </header>

      <div className="body" style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` }}>
        {workspaceError ? (
          <aside className="sidebar">
            <div className="error-box">{workspaceError}</div>
          </aside>
        ) : (
          <Sidebar
            repos={repos}
            changes={changes}
            changesError={changesError}
            expanded={expanded}
            collapsedDirs={collapsedDirs}
            selection={selection}
            filter={filter}
            modeFor={modeFor}
            onFilter={setFilter}
            onToggleRepo={toggleRepo}
            onSetMode={setMode}
            onSelect={selectFile}
            onToggleDir={toggleDir}
            filterRef={filterRef}
          />
        )}

        <div
          className="resizer"
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
        />

        <DiffPane
          key={selection ? `${selection.repo}|${selectionMode}|${selection.path}` : 'none'}
          file={file}
          mode={selectionMode ?? 'worktree'}
          loading={fileLoading}
          error={fileError}
          view={view}
          wrap={wrap}
          theme={theme}
          onView={setView}
          onWrap={setWrap}
          onNav={nav}
          navCount={visibleFiles.length}
          navIndex={navIndex < 0 ? 0 : navIndex}
        />
      </div>
    </div>
  )
}

function systemTheme(): ThemeName {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
