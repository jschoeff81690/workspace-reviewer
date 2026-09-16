import { renderToStaticMarkup } from 'react-dom/server'
import { CodeText } from '../src/client/components/CodeText.tsx'
import { lineTokens, tokenizeFile } from '../src/client/lib/highlight.ts'
import { check, equal, suite } from './assert.ts'

const GO = `package main

import "fmt"

/* a block comment
   spanning lines */
func main() {
	fmt.Println("hi")
}
`

export async function run(): Promise<void> {
  suite('syntax highlighting')

  const tokens = await tokenizeFile(GO, 'go', 'dark')
  check('go grammar loaded', tokens !== null)
  equal('one token array per line', tokens?.length, 9)
  check('keywords coloured', (tokens?.[0] ?? []).some((token) => token.color !== undefined))

  // The payoff of tokenizing whole files: line 6 is still inside the comment
  // opened on line 5, so it must not be coloured as code.
  const commentColor = (tokens?.[4] ?? []).find((t) => t.content.includes('block'))?.color
  const continuation = (tokens?.[5] ?? []).find((t) => t.content.includes('spanning'))?.color
  check('multi-line comment keeps its colour on later lines', !!commentColor && commentColor === continuation)

  const themed = await tokenizeFile(GO, 'go', 'light')
  check(
    'light theme yields different colours',
    JSON.stringify(themed?.[0]) !== JSON.stringify(tokens?.[0]),
  )

  const unknown = await tokenizeFile('just text\n', 'not-a-language', 'dark')
  check('unknown language falls back to plain text', unknown !== null)

  const cached = await tokenizeFile(GO, 'go', 'dark')
  check('repeat tokenization is cached', cached === tokens)

  const tsx = await tokenizeFile('const x = <div className="a" />\n', 'tsx', 'dark')
  check('tsx grammar loaded on demand', (tsx?.[0]?.length ?? 0) > 3)

  suite('syntax highlighting: rendering')
  const line = lineTokens(tokens, 8)
  const markup = renderToStaticMarkup(<CodeText content={'\tfmt.Println("hi")'} tokens={line} />)
  check('tokens render as coloured spans', markup.includes('style="color:'))
  check('content preserved exactly', stripTags(markup) === '\tfmt.Println("hi")')

  const marked = renderToStaticMarkup(
    <CodeText content={'const b = 2'} tokens={undefined} marks={[[10, 11]]} markKind="add" />,
  )
  check('word marks render without tokens', marked.includes('<mark class="w">2</mark>'))
  check('unmarked text survives', stripTags(marked) === 'const b = 2')

  const both = renderToStaticMarkup(
    <CodeText
      content={'\tfmt.Println("hi")'}
      tokens={line}
      marks={[[13, 15]]}
      markKind="add"
    />,
  )
  check('marks split tokens rather than dropping them', both.includes('<mark class="w"'))
  check('token + mark keeps the text intact', stripTags(both) === '\tfmt.Println("hi")')

  const mismatched = renderToStaticMarkup(
    <CodeText content={'different content'} tokens={line} />,
  )
  check('stale tokens fall back to plain text', stripTags(mismatched) === 'different content')
}

function stripTags(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#x27;', "'")
}
