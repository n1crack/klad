import { describe, expect, it } from 'vitest'
import { VERSION } from './index.js'

describe('package', () => {
  it('exports a version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})

// Whether that string matches the version npm actually ships is checked by
// `scripts/check-packages.mjs`, not here: this package compiles with
// `types: []` so its entry stays importable inside a Web Worker, which leaves
// no way to read its own `package.json` from a test. The packaging script has
// Node available and already runs in the release path.
