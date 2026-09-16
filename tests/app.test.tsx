import { renderToStaticMarkup } from 'react-dom/server'
import { check, suite } from './assert.ts'

/**
 * Render the top-level App with the browser APIs it touches during render
 * stubbed out. Effects do not run server-side, so this exercises the initial
 * render path (persisted state, theme choice, empty workspace) without needing
 * a real DOM.
 */
export async function run(): Promise<void> {
  suite('app shell')

  const store = new Map<string, string>()
  const stubWindow = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    matchMedia: () => ({ matches: false }),
  }
  const globals = globalThis as Record<string, unknown>
  const hadWindow = 'window' in globals
  globals.window = stubWindow

  try {
    const { App } = await import('../src/client/App.tsx')
    const markup = renderToStaticMarkup(<App />)
    check('app renders before any data arrives', markup.includes('git'))
    check('topbar present', markup.includes('class="topbar"'))
    check('sidebar present', markup.includes('class="sidebar"'))
    check('resizer present', markup.includes('class="resizer"'))
    check('welcome guidance shown with no selection', markup.includes('Pick a repo on the left'))
    check('shortcut hints listed', markup.includes('<kbd>j</kbd>'))
    check('view switcher rendered', markup.includes('aria-label="View mode"'))

    // A remembered selection must not break the first render either.
    store.set('ws-reviewer:selection', JSON.stringify({ repo: 'alpha', path: 'main.go' }))
    store.set('ws-reviewer:view', JSON.stringify('split'))
    store.set('ws-reviewer:expanded', JSON.stringify(['alpha']))
    store.set('ws-reviewer:theme', JSON.stringify('light'))
    // A remembered per-repo comparison, including one pinned to a commit.
    store.set(
      'ws-reviewer:comparisons',
      JSON.stringify({
        alpha: { mode: 'commit', ref: '0123456789abcdef0123456789abcdef01234567' },
        beta: { mode: 'branch', base: 'origin/main' },
      }),
    )
    const restored = renderToStaticMarkup(<App />)
    check('renders with persisted state', restored.includes('class="topbar"'))
    check('persisted wrap/sort controls render', restored.includes('aria-pressed'))
  } finally {
    if (!hadWindow) delete globals.window
  }
}
