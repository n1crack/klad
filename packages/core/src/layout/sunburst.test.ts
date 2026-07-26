import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { hitTestSector, sunburst } from './sunburst.js'
import type { NodeData } from '../types.js'

const TAU = Math.PI * 2

/**
 * Two top-level branches with different leaf counts (3 vs 1), so the angular
 * split is uneven and a test can tell "by leaf count" apart from "equal
 * shares", plus a third level to drill into.
 */
const DATA: NodeData[] = [
  { id: 'root' },
  { id: 'a', parentId: 'root' },
  { id: 'a1', parentId: 'a' },
  { id: 'a2', parentId: 'a' },
  { id: 'a2x', parentId: 'a2' },
  { id: 'a2y', parentId: 'a2' },
  { id: 'b', parentId: 'root' },
  { id: 'b1', parentId: 'b' },
]

function build() {
  const tree = normalize(DATA)
  const sizes = new Float64Array(tree.count * 2).fill(20)
  return { tree, sizes }
}

interface Sector {
  cx: number
  cy: number
  innerR: number
  outerR: number
  a0: number
  a1: number
}

const sectorOf = (s: Float64Array, i: number): Sector => ({
  cx: s[i * 6]!,
  cy: s[i * 6 + 1]!,
  innerR: s[i * 6 + 2]!,
  outerR: s[i * 6 + 3]!,
  a0: s[i * 6 + 4]!,
  a1: s[i * 6 + 5]!,
})

const OPTS = { spacingX: 16, spacingY: 48, step: 10, maxRings: 3 }

describe('sunburst layout', () => {
  it('puts the root in the hub, spanning the whole turn', () => {
    const { tree, sizes } = build()
    const { sectors } = sunburst(tree, sizes, OPTS)
    const root = sectorOf(sectors!, tree.idToIndex.get('root')!)
    expect(root.innerR).toBe(0)
    expect(root.outerR).toBeGreaterThan(0)
    expect(root.a1 - root.a0).toBeCloseTo(TAU)
  })

  it('splits the circle by leaf count, and a parent spans its children exactly', () => {
    const { tree, sizes } = build()
    const { sectors } = sunburst(tree, sizes, OPTS)
    const at = (id: string) => sectorOf(sectors!, tree.idToIndex.get(id)!)

    // `a` holds 3 leaves, `b` holds 1 — three quarters of the turn against one.
    expect(at('a').a1 - at('a').a0).toBeCloseTo((3 / 4) * TAU)
    expect(at('b').a1 - at('b').a0).toBeCloseTo((1 / 4) * TAU)

    // Containment: a parent's arc is exactly the union of its children's, with
    // no gaps. That is the property the whole chart means — a gap here would
    // make the geometry lie about the data.
    expect(at('a1').a0).toBeCloseTo(at('a').a0)
    expect(at('a1').a1).toBeCloseTo(at('a2').a0)
    expect(at('a2').a1).toBeCloseTo(at('a').a1)
    expect(at('a2x').a0).toBeCloseTo(at('a2').a0)
    expect(at('a2y').a1).toBeCloseTo(at('a2').a1)
  })

  it('stacks generations on consecutive rings', () => {
    const { tree, sizes } = build()
    const { sectors } = sunburst(tree, sizes, OPTS)
    const at = (id: string) => sectorOf(sectors!, tree.idToIndex.get(id)!)
    expect(at('a').innerR).toBeCloseTo(at('root').outerR)
    expect(at('a1').innerR).toBeCloseTo(at('a').outerR)
    expect(at('a').outerR - at('a').innerR).toBeCloseTo(10)
    expect(at('a1').outerR - at('a1').innerR).toBeCloseTo(10)
  })

  it('collapses anything past maxRings to zero thickness at the outer edge', () => {
    const { tree, sizes } = build()
    const { sectors, bounds } = sunburst(tree, sizes, { ...OPTS, maxRings: 1 })
    const at = (id: string) => sectorOf(sectors!, tree.idToIndex.get(id)!)
    // Ring 1 is drawn; ring 2 is not, but still HAS geometry — it is parked on
    // the outer edge so a later focus change has somewhere to animate it from.
    expect(at('a').outerR - at('a').innerR).toBeGreaterThan(0)
    expect(at('a1').outerR - at('a1').innerR).toBe(0)
    expect(at('a1').innerR).toBeCloseTo(bounds.maxX / 2)
  })

  describe('focus', () => {
    it('stretches the focused node to the whole turn and moves it to the hub', () => {
      const { tree, sizes } = build()
      const focus = tree.idToIndex.get('a')!
      const { sectors } = sunburst(tree, sizes, { ...OPTS, focus })
      const at = (id: string) => sectorOf(sectors!, tree.idToIndex.get(id)!)

      expect(at('a').innerR).toBe(0)
      expect(at('a').a1 - at('a').a0).toBeCloseTo(TAU)
      // Its children now share the full circle by their own leaf counts:
      // a1 has 1 leaf, a2 has 2.
      expect(at('a1').a1 - at('a1').a0).toBeCloseTo(TAU / 3)
      expect(at('a2').a1 - at('a2').a0).toBeCloseTo((2 / 3) * TAU)
    })

    it('closes everything outside the focused branch to zero width', () => {
      const { tree, sizes } = build()
      const { sectors } = sunburst(tree, sizes, { ...OPTS, focus: tree.idToIndex.get('a')! })
      const at = (id: string) => sectorOf(sectors!, tree.idToIndex.get(id)!)
      // Still present — not pruned — but with nothing to draw. That is what
      // gives them somewhere to animate to, and back from.
      for (const id of ['b', 'b1']) {
        expect(at(id).a1 - at(id).a0).toBe(0)
      }
    })

    it('collapses the focused node’s ancestors to a point at the centre', () => {
      const { tree, sizes } = build()
      const { sectors } = sunburst(tree, sizes, { ...OPTS, focus: tree.idToIndex.get('a2')! })
      const at = (id: string) => sectorOf(sectors!, tree.idToIndex.get(id)!)
      for (const id of ['root', 'a']) {
        expect(at(id).innerR).toBe(0)
        expect(at(id).outerR).toBe(0)
      }
    })

    it('keeps the frame and the centre fixed whatever is focused', () => {
      const { tree, sizes } = build()
      const views = ['root', 'a', 'a2', 'b'].map((id) =>
        sunburst(tree, sizes, { ...OPTS, focus: tree.idToIndex.get(id)! }),
      )
      // The single most important property of the drill-down: the camera has
      // nothing to chase, so the middle of the wheel stays on the same pixel.
      for (const view of views) {
        expect(view.bounds).toEqual(views[0]!.bounds)
        expect(sectorOf(view.sectors!, 0).cx).toBe(sectorOf(views[0]!.sectors!, 0).cx)
        expect(sectorOf(view.sectors!, 0).cy).toBe(sectorOf(views[0]!.sectors!, 0).cy)
      }
    })

    it('treats "no focus" on a single-rooted tree as focusing that root', () => {
      const { tree, sizes } = build()
      const none = sunburst(tree, sizes, OPTS)
      const root = sunburst(tree, sizes, { ...OPTS, focus: tree.idToIndex.get('root')! })
      expect(Array.from(none.sectors!)).toEqual(Array.from(root.sectors!))
    })

    it('ignores an out-of-range focus rather than producing NaN geometry', () => {
      const { tree, sizes } = build()
      const bad = sunburst(tree, sizes, { ...OPTS, focus: 999 })
      expect(Array.from(bad.sectors!).every(Number.isFinite)).toBe(true)
    })
  })

  it('gives every node a bounding box that contains its sector', () => {
    const { tree, sizes } = build()
    const { boxes, sectors } = sunburst(tree, sizes, OPTS)
    for (let i = 0; i < tree.count; i++) {
      const s = sectorOf(sectors!, i)
      if (s.outerR - s.innerR <= 0 || s.a1 - s.a0 <= 0) continue
      const b = { x: boxes[i * 4]!, y: boxes[i * 4 + 1]!, w: boxes[i * 4 + 2]!, h: boxes[i * 4 + 3]! }
      // Sample the sector's own boundary; every point must land inside the box
      // the culler, minimap and quadtree will use for it.
      for (let t = 0; t <= 1; t += 0.1) {
        const a = s.a0 + (s.a1 - s.a0) * t
        for (const r of [s.innerR, s.outerR]) {
          const x = s.cx + r * Math.cos(a)
          const y = s.cy + r * Math.sin(a)
          expect(x).toBeGreaterThanOrEqual(b.x - 1e-6)
          expect(x).toBeLessThanOrEqual(b.x + b.w + 1e-6)
          expect(y).toBeGreaterThanOrEqual(b.y - 1e-6)
          expect(y).toBeLessThanOrEqual(b.y + b.h + 1e-6)
        }
      }
    }
  })
})

describe('hitTestSector', () => {
  it('resolves a point to the one sector containing it', () => {
    const { tree, sizes } = build()
    const { sectors } = sunburst(tree, sizes, OPTS)
    const n = tree.count
    for (let i = 0; i < n; i++) {
      const s = sectorOf(sectors!, i)
      if (s.outerR - s.innerR <= 0 || s.a1 - s.a0 <= 0) continue
      const r = (s.innerR + s.outerR) / 2
      const a = (s.a0 + s.a1) / 2
      expect(hitTestSector(sectors!, n, s.cx + r * Math.cos(a), s.cy + r * Math.sin(a))).toBe(i)
    }
  })

  it('is a miss outside the outermost ring', () => {
    const { tree, sizes } = build()
    const { sectors } = sunburst(tree, sizes, OPTS)
    const s = sectorOf(sectors!, 0)
    expect(hitTestSector(sectors!, tree.count, s.cx + 10_000, s.cy)).toBe(-1)
  })

  it('never returns a collapsed sector', () => {
    const { tree, sizes } = build()
    const focus = tree.idToIndex.get('a')!
    const { sectors } = sunburst(tree, sizes, { ...OPTS, focus })
    const closed = new Set(['b', 'b1'].map((id) => tree.idToIndex.get(id)!))
    const s = sectorOf(sectors!, 0)
    // Sweep the whole disc; nothing that is closed may ever answer.
    for (let a = 0; a < TAU; a += TAU / 180) {
      for (let r = 1; r < s.outerR; r += 3) {
        const hit = hitTestSector(sectors!, tree.count, s.cx + r * Math.cos(a), s.cy + r * Math.sin(a))
        expect(closed.has(hit)).toBe(false)
      }
    }
  })

  it('answers for a wedge that straddles the atan2 branch cut', () => {
    // Sectors run from -PI/2 to 3PI/2, but `Math.atan2` only reports
    // (-PI, PI] — so the wedges past PI are reachable only through the second
    // of the two turns the hit-test tests. A regression here would make one
    // slice of every wheel unclickable.
    const { tree, sizes } = build()
    const { sectors } = sunburst(tree, sizes, OPTS)
    let found = 0
    for (let i = 0; i < tree.count; i++) {
      const s = sectorOf(sectors!, i)
      if (s.a1 <= Math.PI || s.outerR - s.innerR <= 0 || s.a1 - s.a0 >= TAU - 1e-9) continue
      found++
      const r = (s.innerR + s.outerR) / 2
      const a = (Math.max(s.a0, Math.PI) + s.a1) / 2
      expect(hitTestSector(sectors!, tree.count, s.cx + r * Math.cos(a), s.cy + r * Math.sin(a))).toBe(i)
    }
    expect(found).toBeGreaterThan(0)
  })
})
