import { describe, expect, it } from 'vitest'
import { VERSION } from './index.js'

describe('package', () => {
  it('exports a version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
