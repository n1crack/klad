import { describe, expect, it } from 'vitest'
import { DEFAULT_LOD, lodFor, overlayEnabled } from './lod.js'
import { DEFAULT_THEME, resolveTheme } from './theme.js'

describe('lodFor', () => {
  it('draws blocks below the text threshold', () => {
    expect(lodFor(0.1, DEFAULT_LOD)).toBe('block')
    expect(lodFor(0.249, DEFAULT_LOD)).toBe('block')
  })

  it('draws labels from the text threshold up to the overlay threshold', () => {
    expect(lodFor(0.25, DEFAULT_LOD)).toBe('label')
    expect(lodFor(0.59, DEFAULT_LOD)).toBe('label')
  })

  it('draws full cards at and above the overlay threshold', () => {
    expect(lodFor(0.6, DEFAULT_LOD)).toBe('full')
    expect(lodFor(4, DEFAULT_LOD)).toBe('full')
  })

  it('treats both thresholds as inclusive lower bounds', () => {
    const t = { text: 1, overlay: 2 }
    expect(lodFor(0.999, t)).toBe('block')
    expect(lodFor(1, t)).toBe('label')
    expect(lodFor(1.999, t)).toBe('label')
    expect(lodFor(2, t)).toBe('full')
  })

  it('collapses cleanly when the thresholds are equal', () => {
    const t = { text: 1, overlay: 1 }
    expect(lodFor(0.9, t)).toBe('block')
    expect(lodFor(1, t)).toBe('full')
  })
})

describe('overlayEnabled', () => {
  it('matches the full tier exactly', () => {
    expect(overlayEnabled(0.59, DEFAULT_LOD)).toBe(false)
    expect(overlayEnabled(0.6, DEFAULT_LOD)).toBe(true)
  })
})

describe('resolveTheme', () => {
  it('returns the defaults when given nothing', () => {
    expect(resolveTheme()).toEqual(DEFAULT_THEME)
  })

  it('overrides only the keys provided', () => {
    const theme = resolveTheme({ edgeStroke: 'red' })
    expect(theme.edgeStroke).toBe('red')
    expect(theme.nodeFill).toBe(DEFAULT_THEME.nodeFill)
  })

  it('does not mutate the defaults', () => {
    resolveTheme({ nodeFill: 'hotpink' })
    expect(DEFAULT_THEME.nodeFill).not.toBe('hotpink')
  })
})
