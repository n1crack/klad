import { describe, expect, it } from 'vitest'
import { DEFAULT_LOD, lodFor, overlayEnabled } from './lod.js'
import { DEFAULT_THEME, resolveTheme } from './theme.js'
import type { Theme } from './theme.js'

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

  // F8: inverted thresholds (overlay < text) must not let a lower zoom return
  // a higher tier than a higher zoom would, and must not make 'label'
  // unreachable at every zoom by leaking the raw (too-low) overlay value.
  it('normalises an inverted overlay threshold up to text, instead of deleting the label tier', () => {
    const t = { text: 2, overlay: 1 } // inverted: overlay < text
    // Effective overlay is max(2, 1) = 2, so nothing reaches 'full' below 2,
    // and nothing reaches even 'label' below 2 either, since text is still 2.
    expect(lodFor(0.5, t)).toBe('block')
    expect(lodFor(1, t)).toBe('block')
    expect(lodFor(1.999, t)).toBe('block')
    expect(lodFor(2, t)).toBe('full')
    expect(lodFor(4, t)).toBe('full')
  })

  it('never returns a higher tier at a lower zoom than at a higher zoom, even inverted', () => {
    const tierRank = { block: 0, label: 1, full: 2 } as const
    const thresholdPairs = [
      { text: 0.25, overlay: 0.6 },
      { text: 0.6, overlay: 0.25 }, // inverted
      { text: 1, overlay: 1 },
      { text: 5, overlay: 0 }, // wildly inverted
    ]
    const zooms = [0, 0.1, 0.25, 0.5, 0.6, 0.999, 1, 2, 5, 10]
    for (const t of thresholdPairs) {
      for (let i = 1; i < zooms.length; i++) {
        const prevTier = tierRank[lodFor(zooms[i - 1]!, t)]
        const nextTier = tierRank[lodFor(zooms[i]!, t)]
        expect(nextTier).toBeGreaterThanOrEqual(prevTier)
      }
    }
  })

  it('fails safe to block for a non-finite zoom', () => {
    expect(lodFor(NaN, DEFAULT_LOD)).toBe('block')
    expect(lodFor(NaN, { text: 0, overlay: 0 })).toBe('block')
  })
})

describe('overlayEnabled', () => {
  it('matches the full tier exactly', () => {
    expect(overlayEnabled(0.59, DEFAULT_LOD)).toBe(false)
    expect(overlayEnabled(0.6, DEFAULT_LOD)).toBe(true)
  })

  it('inherits the inverted-threshold normalisation from lodFor (F8)', () => {
    const t = { text: 2, overlay: 1 } // inverted
    expect(overlayEnabled(1.5, t)).toBe(false)
    expect(overlayEnabled(2, t)).toBe(true)
  })

  it('fails safe to false for a non-finite zoom', () => {
    expect(overlayEnabled(NaN, DEFAULT_LOD)).toBe(false)
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

  // F6: DEFAULT_THEME must be frozen so no consumer can poison it globally.
  it('is frozen, so a consumer cannot poison it for every later resolveTheme() call (F6)', () => {
    expect(Object.isFrozen(DEFAULT_THEME)).toBe(true)
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(DEFAULT_THEME as any).nodeFill = 'hotpink'
    }).toThrow()
    expect(DEFAULT_THEME.nodeFill).not.toBe('hotpink')
  })

  // F7: an explicit `undefined` in the partial must not wipe a default.
  // `exactOptionalPropertyTypes` blocks this shape at the TS boundary for a
  // well-typed caller, but a JS consumer or a cast can still produce it.
  it('ignores an explicit undefined in the partial instead of erasing the default (F7)', () => {
    const partial = { nodeStroke: undefined, edgeStroke: 'red' } as unknown as Partial<Theme>
    const theme = resolveTheme(partial)
    expect(theme.nodeStroke).toBe(DEFAULT_THEME.nodeStroke)
    expect(theme.edgeStroke).toBe('red')
  })
})
