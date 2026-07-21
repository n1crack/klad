import { describe, expect, it } from 'vitest'
import { buildQuadTree } from './quadtree.js'
import type { Bounds } from '../types.js'

const BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }

/** Four boxes, one per quadrant of a 1000x1000 space. */
function quadrants(): Float64Array {
  return Float64Array.from([
    10, 10, 100, 100, // 0: top-left
    890, 10, 100, 100, // 1: top-right
    10, 890, 100, 100, // 2: bottom-left
    890, 890, 100, 100, // 3: bottom-right
  ])
}

function queryAll(tree: ReturnType<typeof buildQuadTree>, rect: Bounds, capacity = 64): number[] {
  const out = new Uint32Array(capacity)
  const count = tree.query(rect, out)
  return Array.from(out.subarray(0, count)).sort((a, b) => a - b)
}

/** Builds a Float64Array from readable [x, y, w, h] tuples. */
function boxesFrom(entries: ReadonlyArray<readonly [number, number, number, number]>): Float64Array {
  const flat = new Float64Array(entries.length * 4)
  entries.forEach(([x, y, w, h], i) => {
    flat[i * 4] = x
    flat[i * 4 + 1] = y
    flat[i * 4 + 2] = w
    flat[i * 4 + 3] = h
  })
  return flat
}

/** Brute-force linear scan used as the ground truth to cross-check the tree against. */
function bruteQuery(boxes: Float64Array, rect: Bounds): number[] {
  const count = Math.floor(boxes.length / 4)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const o = i * 4
    const x0 = boxes[o]!
    const y0 = boxes[o + 1]!
    const x1 = x0 + boxes[o + 2]!
    const y1 = y0 + boxes[o + 3]!
    if (x0 < rect.maxX && x1 > rect.minX && y0 < rect.maxY && y1 > rect.minY) out.push(i)
  }
  return out
}

/** Brute-force linear scan for hitTest: highest index whose box contains the point. */
function bruteHitTest(boxes: Float64Array, x: number, y: number): number {
  const count = Math.floor(boxes.length / 4)
  let best = -1
  for (let i = 0; i < count; i++) {
    const o = i * 4
    const x0 = boxes[o]!
    const y0 = boxes[o + 1]!
    const x1 = x0 + boxes[o + 2]!
    const y1 = y0 + boxes[o + 3]!
    if (x >= x0 && x < x1 && y >= y0 && y < y1) best = i
  }
  return best
}

describe('buildQuadTree', () => {
  it('returns only the boxes overlapping the query rect', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(queryAll(tree, { minX: 0, minY: 0, maxX: 200, maxY: 200 })).toEqual([0])
    expect(queryAll(tree, { minX: 800, minY: 800, maxX: 1000, maxY: 1000 })).toEqual([3])
  })

  it('returns every box for a full-extent query', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(queryAll(tree, BOUNDS)).toEqual([0, 1, 2, 3])
  })

  it('counts a box that straddles the query edge', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    // Rect ends at x=50, box 0 spans 10..110 — they overlap.
    expect(queryAll(tree, { minX: 0, minY: 0, maxX: 50, maxY: 50 })).toEqual([0])
  })

  it('returns nothing for a rect in empty space', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(queryAll(tree, { minX: 400, minY: 400, maxX: 600, maxY: 600 })).toEqual([])
  })

  it('stops writing when the output buffer is full', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    const out = new Uint32Array(2)
    expect(tree.query(BOUNDS, out)).toBe(2)
  })

  it('hit-tests a point inside a box', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(tree.hitTest(50, 50)).toBe(0)
    expect(tree.hitTest(900, 900)).toBe(3)
  })

  it('returns -1 for a point in a gap', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(tree.hitTest(500, 500)).toBe(-1)
    expect(tree.hitTest(-5, -5)).toBe(-1)
  })

  it('treats box edges as inclusive on the top-left, exclusive on the bottom-right', () => {
    const tree = buildQuadTree(Float64Array.from([100, 100, 50, 50]), BOUNDS)
    expect(tree.hitTest(100, 100)).toBe(0)
    expect(tree.hitTest(149.9, 149.9)).toBe(0)
    expect(tree.hitTest(150, 150)).toBe(-1)
  })

  it('returns the highest index when boxes overlap', () => {
    const tree = buildQuadTree(
      Float64Array.from([100, 100, 100, 100, 120, 120, 100, 100]),
      BOUNDS,
    )
    expect(tree.hitTest(150, 150)).toBe(1)
  })

  it('handles an empty layout', () => {
    const tree = buildQuadTree(new Float64Array(0), { minX: 0, minY: 0, maxX: 0, maxY: 0 })
    expect(tree.hitTest(0, 0)).toBe(-1)
    expect(queryAll(tree, BOUNDS)).toEqual([])
  })

  it('culls a 50k grid to only the boxes overlapping the window', () => {
    const count = 50_000
    const boxes = new Float64Array(count * 4)
    const perRow = 250
    for (let i = 0; i < count; i++) {
      boxes[i * 4] = (i % perRow) * 240
      boxes[i * 4 + 1] = Math.floor(i / perRow) * 120
      boxes[i * 4 + 2] = 220
      boxes[i * 4 + 3] = 96
    }
    const bounds = { minX: 0, minY: 0, maxX: perRow * 240, maxY: Math.ceil(count / perRow) * 120 }
    const tree = buildQuadTree(boxes, bounds)

    const rect = { minX: 0, minY: 0, maxX: 1200, maxY: 600 }
    const out = new Uint32Array(count)
    const found = tree.query(rect, out)
    // A 1200x600 window over a 240x120 grid covers exactly 25 cells (5 cols x 5 rows).
    expect(found).toBe(25)
    expect(Array.from(out.subarray(0, found)).sort((a, b) => a - b)).toEqual(bruteQuery(boxes, rect))
  })

  describe('root is treated as unbounded', () => {
    // A box that fits no child (because it lies outside `bounds`) stays in
    // root.items. The root must never be rejected by the rect/point test,
    // or such a box becomes permanently invisible to query and hitTest.
    it('finds a box that lies entirely outside bounds, via query', () => {
      const tree = buildQuadTree(Float64Array.from([1100, 100, 100, 100]), BOUNDS)
      expect(queryAll(tree, { minX: 1050, minY: 50, maxX: 1300, maxY: 300 }, 4)).toEqual([0])
    })

    it('finds a box that lies entirely outside bounds, via hitTest', () => {
      const tree = buildQuadTree(Float64Array.from([950, 100, 200, 100]), BOUNDS)
      expect(tree.hitTest(1100, 150)).toBe(0)
    })

    it('finds a box outside bounds on the negative side', () => {
      const tree = buildQuadTree(Float64Array.from([-100, -100, 50, 50]), BOUNDS)
      expect(tree.hitTest(-90, -90)).toBe(0)
    })

    it('finds a box when bounds itself is degenerate (zero-area)', () => {
      const tree = buildQuadTree(Float64Array.from([10, 10, 10, 10]), {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
      })
      expect(queryAll(tree, BOUNDS, 4)).toEqual([0])
    })
  })

  describe('splitting across multiple levels', () => {
    // 9 identical tiny boxes clustered at (750, 750) force cascading splits:
    // the root reaches SPLIT_THRESHOLD (8) and splits on the 9th insertion,
    // and because every box is identical, the same cascade repeats in the
    // child that keeps receiving all of them until the quad shrinks below
    // the box size — several real levels of splitting, not just one.
    const clusterEntries: Array<readonly [number, number, number, number]> = []
    for (let i = 0; i < 9; i++) clusterEntries.push([750, 750, 3, 3])

    it('keeps results exact once the tree has split multiple levels deep', () => {
      const boxes = boxesFrom(clusterEntries)
      const tree = buildQuadTree(boxes, BOUNDS)
      const rect = { minX: 700, minY: 700, maxX: 800, maxY: 800 }
      expect(queryAll(tree, rect, 32)).toEqual(bruteQuery(boxes, rect))
      expect(tree.hitTest(751, 751)).toBe(8)
    })

    it('tie-breaks on index, not depth: a deep box beats a shallow lower-index box', () => {
      // index 0: shallow, stays at the root (spans across the root's own
      // split lines in both axes, so it never fits into any of the root's
      // 4 children and is never re-homed any deeper).
      // indices 1..9: deep cluster, all containing (750, 750).
      const entries: Array<readonly [number, number, number, number]> = [
        [450, 450, 350, 350], // 0: straddling box, low index, ends up shallow
        ...clusterEntries, // 1..9: deep cluster, higher indices
      ]
      const boxes = boxesFrom(entries)
      const tree = buildQuadTree(boxes, BOUNDS)
      expect(tree.hitTest(750, 750)).toBe(bruteHitTest(boxes, 750, 750))
      expect(tree.hitTest(750, 750)).toBe(9)
    })

    it('tie-breaks on index, not depth: a shallow high-index box beats deep lower-index boxes', () => {
      // indices 0..8: deep cluster, lower indices.
      // index 9: straddling box, highest index, ends up shallow (at the root).
      const entries: Array<readonly [number, number, number, number]> = [
        ...clusterEntries, // 0..8: deep cluster, lower indices
        [450, 450, 350, 350], // 9: straddling box, highest index, stays shallow
      ]
      const boxes = boxesFrom(entries)
      const tree = buildQuadTree(boxes, BOUNDS)
      expect(tree.hitTest(750, 750)).toBe(bruteHitTest(boxes, 750, 750))
      expect(tree.hitTest(750, 750)).toBe(9)
    })

    it('survives a small-buffer query, then a hitTest, then a full query on a split tree', () => {
      // Scatter 200 boxes across all four quadrants so the tree splits several
      // levels deep and the traversal stack sees real multi-level push/pop
      // activity. The reused stack must be fully reset between calls.
      const entries: Array<readonly [number, number, number, number]> = []
      for (let i = 0; i < 200; i++) {
        const col = i % 20
        const row = Math.floor(i / 20)
        entries.push([col * 45 + 5, row * 45 + 5, 20, 20])
      }
      const boxes = boxesFrom(entries)
      const tree = buildQuadTree(boxes, BOUNDS)
      const rect = BOUNDS

      // 1. Query with a buffer far too small to hold all matches: forces the
      //    early return mid-traversal, leaving the stack in a partial state.
      const tinyOut = new Uint32Array(1)
      const tinyFound = tree.query(rect, tinyOut)
      expect(tinyFound).toBe(1)

      // 2. hitTest reuses the same stack right after the truncated query.
      const hit = tree.hitTest(entries[42]![0] + 1, entries[42]![1] + 1)
      expect(hit).toBe(bruteHitTest(boxes, entries[42]![0] + 1, entries[42]![1] + 1))

      // 3. A full query with an ample buffer must return the complete,
      //    correct set — proof the stack was not left corrupted by 1 or 2.
      const ampleOut = new Uint32Array(entries.length)
      const fullFound = tree.query(rect, ampleOut)
      expect(Array.from(ampleOut.subarray(0, fullFound)).sort((a, b) => a - b)).toEqual(
        bruteQuery(boxes, rect),
      )
    })
  })

  describe('maxDepth', () => {
    it('still lands items and returns exact results when maxDepth = 0 (full linear scan)', () => {
      const boxes = quadrants()
      const tree = buildQuadTree(boxes, BOUNDS, 0)
      expect(queryAll(tree, BOUNDS)).toEqual(bruteQuery(boxes, BOUNDS))
      expect(tree.hitTest(50, 50)).toBe(bruteHitTest(boxes, 50, 50))
      expect(tree.hitTest(900, 900)).toBe(bruteHitTest(boxes, 900, 900))
    })

    it('still lands items and returns exact results for a deeply-splitting tree at a shallow cap', () => {
      const entries: Array<readonly [number, number, number, number]> = []
      for (let i = 0; i < 40; i++) entries.push([750, 750, 3, 3])
      const boxes = boxesFrom(entries)
      const tree = buildQuadTree(boxes, BOUNDS, 1)
      const rect = { minX: 700, minY: 700, maxX: 800, maxY: 800 }
      expect(queryAll(tree, rect, 64)).toEqual(bruteQuery(boxes, rect))
      expect(tree.hitTest(751, 751)).toBe(bruteHitTest(boxes, 751, 751))
    })
  })

  describe('ragged input', () => {
    it('floors a box count that is not a multiple of 4 instead of reading past the end', () => {
      // Length 5 is one full box plus one stray trailing coordinate.
      const boxes = Float64Array.from([10, 10, 50, 50, 999])
      const tree = buildQuadTree(boxes, BOUNDS)
      expect(queryAll(tree, BOUNDS)).toEqual([0])
      expect(tree.hitTest(20, 20)).toBe(0)
    })
  })
})
