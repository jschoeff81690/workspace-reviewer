import { finish } from './assert.ts'
import { makeFixture, removeFixture } from './fixture.ts'
import * as apiTests from './api.test.ts'
import * as appTests from './app.test.tsx'
import * as highlightTests from './highlight.test.tsx'
import * as logicTests from './logic.test.ts'
import * as renderTests from './render.test.tsx'

logicTests.run()

const fixture = makeFixture()
try {
  await apiTests.run(fixture)
  await renderTests.run(fixture)
  await highlightTests.run()
  await appTests.run()
} finally {
  removeFixture(fixture)
}

finish()
