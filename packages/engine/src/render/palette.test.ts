import { describe, expect, it } from 'vitest'
import { computeNodeFills, DARK_PALETTE, DEFAULT_PALETTE, depthStep, inkOn } from './palette.js'

const HUB = '#f0efec'
const OTHER = '#9c9c96'

/** WCAG relative luminance, for the ordering assertions below. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const chan = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255)
}

describe('depthStep', () => {
  it('returns the base colour untouched at depth 0', () => {
    for (const hex of DEFAULT_PALETTE) expect(depthStep(hex, 0)).toBe(hex)
  })

  it('gets monotonically lighter with depth', () => {
    for (const hex of DEFAULT_PALETTE) {
      let previous = luminance(hex)
      for (let d = 1; d <= 4; d++) {
        const next = luminance(depthStep(hex, d))
        expect(next).toBeGreaterThan(previous)
        previous = next
      }
    }
  })

  it('holds still past the cap rather than washing out to white', () => {
    for (const hex of DEFAULT_PALETTE.slice(0, 3)) {
      expect(depthStep(hex, 9)).toBe(depthStep(hex, 4))
    }
  })

  it('always produces a valid hex colour', () => {
    for (const hex of [...DEFAULT_PALETTE, ...DARK_PALETTE]) {
      for (let d = 0; d <= 6; d++) expect(depthStep(hex, d)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('passes through anything it cannot parse, rather than mangling it', () => {
    // A host is free to put a CSS variable or a named colour in the palette
    // and take responsibility for depth itself.
    for (const value of ['currentColor', 'var(--brand)', 'rebeccapurple', 'rgb(1 2 3)']) {
      expect(depthStep(value, 3)).toBe(value)
    }
  })

  it('accepts three-digit hex', () => {
    expect(depthStep('#08f', 0)).toBe('#08f')
    expect(depthStep('#08f', 2)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('inkOn', () => {
  const DARK = '#0b0b0b'
  const LIGHT = '#ffffff'

  it('picks whichever ink actually reads on the fill', () => {
    expect(inkOn('#ffffff', DARK, LIGHT)).toBe(DARK)
    expect(inkOn('#000000', DARK, LIGHT)).toBe(LIGHT)
  })

  it('picks per-fill across a whole palette rather than one ink for all', () => {
    // The point of the function: several categorical hues are mid-lightness,
    // and a single fixed label colour is unreadable on roughly half of them.
    const chosen = new Set(DEFAULT_PALETTE.map((hex) => inkOn(hex, DARK, LIGHT)))
    expect(chosen.size).toBe(2)
  })

  it('falls back to the dark ink for a fill it cannot parse', () => {
    expect(inkOn('var(--brand)', DARK, LIGHT)).toBe(DARK)
  })
})

describe('computeNodeFills', () => {
  /** Three branches under one root, each with a child and a grandchild. */
  function tree(branchCount: number) {
    const branchOf: number[] = [-1]
    const branchDepth: number[] = [0]
    for (let b = 0; b < branchCount; b++) {
      const root = branchOf.length
      branchOf.push(root, root, root)
      branchDepth.push(0, 1, 2)
    }
    return {
      count: branchOf.length,
      branchOf: Int32Array.from(branchOf),
      branchDepth: Int32Array.from(branchDepth),
    }
  }

  it('gives the root the hub colour, not a series colour', () => {
    const t = tree(3)
    const fills = computeNodeFills(t.count, t.branchOf, t.branchDepth, DEFAULT_PALETTE, OTHER, HUB)
    // The root is what the branches hang off, not one of them — giving it
    // slot 1 makes the first branch look like the root's continuation.
    expect(fills[0]).toBe(HUB)
    expect(fills[1]).not.toBe(HUB)
  })

  it('hands out slots in the order branches are first seen', () => {
    const t = tree(3)
    const fills = computeNodeFills(t.count, t.branchOf, t.branchDepth, DEFAULT_PALETTE, OTHER, HUB)
    expect(fills[1]).toBe(DEFAULT_PALETTE[0])
    expect(fills[4]).toBe(DEFAULT_PALETTE[1])
    expect(fills[7]).toBe(DEFAULT_PALETTE[2])
  })

  it('gives every node in one branch the same hue, stepped by depth', () => {
    const t = tree(2)
    const fills = computeNodeFills(t.count, t.branchOf, t.branchDepth, DEFAULT_PALETTE, OTHER, HUB)
    expect(fills[1]).toBe(DEFAULT_PALETTE[0])
    expect(fills[2]).toBe(depthStep(DEFAULT_PALETTE[0]!, 1))
    expect(fills[3]).toBe(depthStep(DEFAULT_PALETTE[0]!, 2))
    expect(luminance(fills[3]!)).toBeGreaterThan(luminance(fills[1]!))
  })

  it('folds branches past the last slot into one neutral, never cycling', () => {
    // Two branches sharing a hue is a lie about the data. A branch that is
    // visibly "not one of the named ones" is not.
    const t = tree(DEFAULT_PALETTE.length + 3)
    const fills = computeNodeFills(t.count, t.branchOf, t.branchDepth, DEFAULT_PALETTE, OTHER, HUB)
    const branchRoots = Array.from({ length: DEFAULT_PALETTE.length + 3 }, (_, b) => fills[1 + b * 3]!)
    expect(branchRoots.slice(0, DEFAULT_PALETTE.length)).toEqual([...DEFAULT_PALETTE])
    expect(branchRoots.slice(DEFAULT_PALETTE.length)).toEqual([OTHER, OTHER, OTHER])
    // And specifically: slot 1's colour appears for slot 1 and nowhere else.
    expect(branchRoots.filter((c) => c === DEFAULT_PALETTE[0]).length).toBe(1)
  })

  it('is stable — a node’s colour depends only on its own branch and depth', () => {
    // What makes a branch trackable through a drill-down. Rebuilding the same
    // structure must give the same answer, whatever else changed around it.
    const a = tree(3)
    const b = tree(5)
    const fillsA = computeNodeFills(a.count, a.branchOf, a.branchDepth, DEFAULT_PALETTE, OTHER, HUB)
    const fillsB = computeNodeFills(b.count, b.branchOf, b.branchDepth, DEFAULT_PALETTE, OTHER, HUB)
    expect(fillsB.slice(0, a.count)).toEqual(fillsA)
  })

  it('handles an empty tree', () => {
    expect(computeNodeFills(0, new Int32Array(0), new Int32Array(0), DEFAULT_PALETTE, OTHER, HUB)).toEqual([])
  })
})
