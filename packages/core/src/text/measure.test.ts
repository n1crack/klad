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
})
