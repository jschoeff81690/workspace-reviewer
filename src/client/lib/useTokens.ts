import { useEffect, useState } from 'react'
import { tokenizeFile, type ThemeName, type TokenLines } from './highlight.ts'

export interface TokenState {
  tokens: TokenLines | null
  pending: boolean
}

/**
 * Tokenize a whole file off the render path: the text paints immediately and
 * the colours land a tick later, which keeps large files from blocking.
 */
export function useTokens(content: string | null, language: string, theme: ThemeName): TokenState {
  const [state, setState] = useState<TokenState>({ tokens: null, pending: content !== null })

  useEffect(() => {
    if (content === null) {
      setState({ tokens: null, pending: false })
      return
    }
    let alive = true
    setState((prev) => ({ tokens: prev.tokens, pending: true }))
    const handle = setTimeout(() => {
      tokenizeFile(content, language, theme)
        .then((tokens) => {
          if (alive) setState({ tokens, pending: false })
        })
        .catch(() => {
          if (alive) setState({ tokens: null, pending: false })
        })
    }, 0)
    return () => {
      alive = false
      clearTimeout(handle)
    }
  }, [content, language, theme])

  return state
}
