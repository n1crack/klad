import { describe, expect, it, vi } from 'vitest'
import { createTextMeasurer } from './measure.js'

/** 10 units per character — makes every expectation arithmetic. */
function fixedWidthSource() {
  return { measureWidth: vi.fn((text: string) => text.length * 10) }
}

describe('createTextMeasurer', () => {
  it('returns the source width', () => {
    const m = createTextMeasurer(fixedWidthSource())
    expect(m.width('abc')).toBe(30)
  })

  it('measures each distinct string only once', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source)
    m.width('abc')
    m.width('abc')
    m.width('abc')
    expect(source.measureWidth).toHaveBeenCalledTimes(1)
    expect(m.size).toBe(1)
  })

  it('returns text unchanged when it already fits', () => {
    const m = createTextMeasurer(fixedWidthSource())
    expect(m.truncate('abcde', 50)).toBe('abcde')
    expect(m.truncate('abcde', 999)).toBe('abcde')
  })

  it('truncates with an ellipsis to the longest prefix that fits', () => {
    const m = createTextMeasurer(fixedWidthSource())
    // Ellipsis is 10 wide, so a 45-wide budget leaves 35 for the prefix -> 3 chars.
    expect(m.truncate('abcdefgh', 45)).toBe('abc…')
  })

  it('honours a custom ellipsis', () => {
    const m = createTextMeasurer(fixedWidthSource())
    // '...' is 30 wide, leaving 30 of a 60 budget -> 3 chars.
    expect(m.truncate('abcdefgh', 60, '...')).toBe('abc...')
  })

  it('returns an empty string when not even the ellipsis fits', () => {
    const m = createTextMeasurer(fixedWidthSource())
    expect(m.truncate('abcdefgh', 5)).toBe('')
    expect(m.truncate('abcdefgh', 0)).toBe('')
  })

  it('truncates in a logarithmic number of measurements, not linear', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source)
    const text = 'x'.repeat(1000)
    m.truncate(text, 500)
    // Binary search over 1000 positions is ~10 probes; allow slack for the
    // full-string and ellipsis measurements. A linear scan would be ~1000.
    expect(source.measureWidth.mock.calls.length).toBeLessThan(25)
  })

  it('handles an empty string', () => {
    const m = createTextMeasurer(fixedWidthSource())
    expect(m.width('')).toBe(0)
    expect(m.truncate('', 100)).toBe('')
  })

  it('evicts the oldest entry when the cache is full', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source, 2)
    m.width('a')
    m.width('b')
    m.width('c')
    expect(m.size).toBe(2)
    m.width('a') // evicted, so measured again
    expect(source.measureWidth).toHaveBeenCalledTimes(4)
  })

  it('drops everything on clear', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source)
    m.width('abc')
    m.clear()
    expect(m.size).toBe(0)
    m.width('abc')
    expect(source.measureWidth).toHaveBeenCalledTimes(2)
  })

  it('never calls the source for an empty string', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source)
    expect(m.width('')).toBe(0)
    expect(source.measureWidth).not.toHaveBeenCalled()
  })

  // F1: `truncate` must cut on grapheme-cluster boundaries, not UTF-16 code
  // units, or an astral character (or any surrogate pair) gets split into a
  // lone high surrogate that renders as a broken glyph.
  it('does not split a surrogate pair when truncating (F1)', () => {
    const m = createTextMeasurer(fixedWidthSource())
    // Each emoji is one grapheme cluster, 2 UTF-16 code units wide -> 20
    // width units. Old code-unit slicing at budget 30 (maxWidth 40 - ellipsis
    // 10) would cut at code unit 3, landing inside the second emoji's
    // surrogate pair and producing a lone high surrogate.
    const emoji = '\u{1F600}'
    const result = m.truncate(emoji + emoji + emoji + emoji, 40)
    expect(result).toBe(emoji + '…')
    // Belt-and-braces: no lone surrogate anywhere in the result.
    for (let i = 0; i < result.length; i++) {
      const code = result.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) {
        expect(result.charCodeAt(i + 1)).toBeGreaterThanOrEqual(0xdc00)
        expect(result.charCodeAt(i + 1)).toBeLessThanOrEqual(0xdfff)
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        expect(result.charCodeAt(i - 1)).toBeGreaterThanOrEqual(0xd800)
        expect(result.charCodeAt(i - 1)).toBeLessThanOrEqual(0xdbff)
      }
    }
  })

  it('never separates a combining mark from its base character', () => {
    const m = createTextMeasurer(fixedWidthSource())
    // 'e' + combining acute accent (U+0301) is one grapheme cluster of 2 code
    // units, followed by 3 plain characters (5 code units total).
    const text = 'éxyz'
    // Old code-unit slicing at budget 15 (maxWidth 25 - ellipsis 10) would cut
    // at code unit 1, splitting the base from its mark and silently dropping
    // the accent. A grapheme-aware search can only choose "no cluster" or
    // "whole cluster" as a cut point.
    expect(m.truncate(text, 25)).toBe('…')
    // At a wider budget the whole base+mark cluster is kept together, plus
    // as much more as fits.
    expect(m.truncate(text, 40)).toBe('éx…')
  })

  // F2: binary-search probes must not pollute the shared width cache; only
  // `width()` calls (full string + ellipsis) should land there.
  it('does not pollute the shared cache with binary-search probes (F2)', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source)
    const text = 'x'.repeat(200)
    m.truncate(text, 100)
    // Only the full-string width and the ellipsis width belong in the shared
    // cache; every intermediate probe from the search must be discarded.
    expect(m.size).toBeLessThanOrEqual(2)
  })

  it('memoises the truncation result so a repeated call re-measures nothing (F2)', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source)
    const text = 'x'.repeat(200)
    m.truncate(text, 100)
    const callsAfterFirst = source.measureWidth.mock.calls.length
    expect(m.truncate(text, 100)).toBe(m.truncate(text, 100))
    expect(source.measureWidth.mock.calls.length).toBe(callsAfterFirst)
  })

  it('does not confuse cached truncations across different maxWidth or ellipsis', () => {
    const m = createTextMeasurer(fixedWidthSource())
    const a = m.truncate('abcdefgh', 45)
    const b = m.truncate('abcdefgh', 60, '...')
    expect(a).toBe('abc…')
    expect(b).toBe('abc...')
  })

  // F3: the search must bound width(slice + ellipsis) directly, since real
  // canvases kern the last glyph against the ellipsis and widths don't add.
  describe('honours maxWidth even when the source is non-additive (F3)', () => {
    // Models a kerning pair: a 'W' immediately before the ellipsis costs 40
    // extra width units, on top of the flat 10-per-character rate.
    function rawKerningWidth(text: string): number {
      const flat = text.length * 10
      return text.endsWith('W…') ? flat + 40 : flat
    }
    function kerningSource() {
      return { measureWidth: vi.fn(rawKerningWidth) }
    }

    it('reproduces the reported case without exceeding the budget', () => {
      const m = createTextMeasurer(kerningSource())
      const result = m.truncate('WWWWWW', 45)
      expect(rawKerningWidth(result)).toBeLessThanOrEqual(45)
    })

    it('sweeps lengths and budgets and never returns a result wider than maxWidth', () => {
      for (const len of [0, 1, 2, 3, 4, 5, 8, 10, 20, 50]) {
        const text = 'W'.repeat(len)
        const m = createTextMeasurer(kerningSource())
        for (let budget = 0; budget <= 120; budget += 5) {
          const result = m.truncate(text, budget)
          expect(rawKerningWidth(result)).toBeLessThanOrEqual(budget)
        }
      }
    })

    it('holds for the plain additive fake source too, swept', () => {
      const rawFlatWidth = (text: string): number => text.length * 10
      for (const len of [0, 1, 3, 8, 20, 47]) {
        const text = 'a'.repeat(len)
        const m = createTextMeasurer(fixedWidthSource())
        for (let budget = 0; budget <= 500; budget += 7) {
          const result = m.truncate(text, budget)
          expect(rawFlatWidth(result)).toBeLessThanOrEqual(budget)
        }
      }
    })
  })

  // F4: when nothing else fits but the ellipsis itself does, return the
  // ellipsis rather than ''. An empty string tells the reader nothing was
  // there; the ellipsis tells them something was cut.
  it('returns the bare ellipsis when the budget matches its width exactly (F4)', () => {
    const m = createTextMeasurer(fixedWidthSource())
    // Default ellipsis '…' is 10 wide (1 char * 10); maxWidth 10 leaves
    // exactly no room for any prefix character.
    expect(m.truncate('abcdefgh', 10)).toBe('…')
  })

  it('still returns "" when even the bare ellipsis does not fit', () => {
    const m = createTextMeasurer(fixedWidthSource())
    expect(m.truncate('abcdefgh', 9)).toBe('')
    expect(m.truncate('abcdefgh', 0)).toBe('')
  })

  // F5: `maxEntries <= 0` must still bound the cache, at 1 entry minimum.
  it('clamps maxEntries to at least 1 (F5)', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source, 0)
    m.width('a')
    m.width('b')
    expect(m.size).toBe(1)

    const source2 = fixedWidthSource()
    const m2 = createTextMeasurer(source2, -5)
    m2.width('a')
    m2.width('b')
    expect(m2.size).toBe(1)
  })
})
