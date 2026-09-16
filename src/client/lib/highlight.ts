import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type SpecialLanguage,
  type ThemedToken,
} from 'shiki'

export type ThemeName = 'dark' | 'light'

export const SHIKI_THEMES: Record<ThemeName, string> = {
  dark: 'github-dark-default',
  light: 'github-light-default',
}

/** Above this, tokenizing costs more than the highlighting is worth. */
export const MAX_HIGHLIGHT_LINES = 20_000

export type TokenLines = ThemedToken[][]

let highlighterPromise: Promise<Highlighter> | null = null
const loaded = new Set<string>()

function isBundled(lang: string): boolean {
  return Object.hasOwn(bundledLanguages, lang)
}

async function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [SHIKI_THEMES.dark, SHIKI_THEMES.light],
    langs: [],
  })
  return await highlighterPromise
}

/** Load a grammar on demand, falling back to plain text for unknown ids. */
async function ensureLanguage(lang: string): Promise<string> {
  if (lang === 'text' || !isBundled(lang)) return 'text'
  if (loaded.has(lang)) return lang
  const highlighter = await getHighlighter()
  try {
    await highlighter.loadLanguage(lang as Parameters<Highlighter['loadLanguage']>[0])
    loaded.add(lang)
    return lang
  } catch {
    return 'text'
  }
}

const CACHE_LIMIT = 16
const cache = new Map<string, TokenLines>()

/** Cheap, stable content key; collisions would only mean a wrong cache hit on identical-length text. */
function contentKey(code: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${code.length}.${(hash >>> 0).toString(36)}`
}

/**
 * Tokenize a whole file so multi-line constructs (block comments, template
 * strings) are coloured correctly even though we render line by line.
 * Returns one token array per line, indexed from line 1.
 */
export async function tokenizeFile(
  code: string,
  lang: string,
  theme: ThemeName,
): Promise<TokenLines | null> {
  const body = code.endsWith('\n') ? code.slice(0, -1) : code
  const lineCount = body === '' ? 0 : body.split('\n').length
  if (lineCount > MAX_HIGHLIGHT_LINES) return null

  const resolved = await ensureLanguage(lang)
  const key = `${resolved}|${theme}|${contentKey(body)}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  const highlighter = await getHighlighter()
  const result = highlighter.codeToTokens(body, {
    lang: resolved as BundledLanguage | SpecialLanguage,
    theme: SHIKI_THEMES[theme],
  })

  cache.set(key, result.tokens)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  return result.tokens
}

/** Preload the engine so the first file paints highlighted. */
export function warmHighlighter(): void {
  void getHighlighter()
}

/** Tokens for a 1-based line number, if that line was tokenized. */
export function lineTokens(tokens: TokenLines | null, lineNumber: number | null): ThemedToken[] | undefined {
  if (!tokens || lineNumber === null) return undefined
  return tokens[lineNumber - 1]
}
