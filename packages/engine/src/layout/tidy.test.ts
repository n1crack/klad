import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { layout } from './tidy.js'
import type { NodeData } from '../types.js'

const OPTS = { spacingX: 10, spacingY: 20 }

/** Builds a uniform size array so tests can focus on positions. */
function uniformSizes(count: number, w = 100, h = 50): Float64Array {
  const sizes = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    sizes[i * 2] = w
    sizes[i * 2 + 1] = h
  }
  return sizes
}

function boxOf(tree: ReturnType<typeof normalize>, boxes: Float64Array, id: string) {
  const i = tree.idToIndex.get(id)!
  return { x: boxes[i * 4]!, y: boxes[i * 4 + 1]!, w: boxes[i * 4 + 2]!, h: boxes[i * 4 + 3]! }
}

// --- Deterministic PRNG (mulberry32) -----------------------------------
// No Math.random(): every property-test failure below must be reproducible
// from the seed alone, and this package takes no runtime dependencies, so
// the generator is written inline rather than pulled in from npm.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A "brush": one root with `chainCount` independent chains hanging off it,
 * each of its own random length. This is the shape that drives the
 * shift-distribution path in `distributeExtra`/`addChildSpacing`.
 */
function buildBrushTree(rng: () => number, chainCount: number, maxChainLen: number): NodeData[] {
  const data: NodeData[] = [{ id: 'root' }]
  for (let c = 0; c < chainCount; c++) {
    const len = 1 + Math.floor(rng() * maxChainLen)
    let prev = 'root'
    for (let k = 0; k < len; k++) {
      const id = `c${c}-${k}`
      data.push({ id, parentId: prev })
      prev = id
    }
  }
  return data
}

/**
 * A bushy tree: every expanded node gets 8-20 children, but only about half
 * of those children are themselves candidates for further expansion, chosen
 * in random order off a frontier. That combination produces wildly unequal
 * subtree depths under wide fan-out -- some branches terminate after one
 * level while siblings a few nodes over run many levels deep. This is what
 * drives the real shift-distribution path in `separate()`
 * (`iylIndex[ih] < i - 1`): a low-y entry from an early, shallow branch stays
 * live in the IYL list while later, deeper siblings get separated against it.
 */
function buildBushyTree(rng: () => number, count: number): NodeData[] {
  const data: NodeData[] = [{ id: 'n0' }]
  const frontier: number[] = [0]
  let id = 1
  while (id < count && frontier.length > 0) {
    const pick = Math.floor(rng() * frontier.length)
    const parentIdx = frontier[pick]!
    frontier.splice(pick, 1)
    const childCount = Math.min(8 + Math.floor(rng() * 13), count - id)
    for (let k = 0; k < childCount && id < count; k++) {
      data.push({ id: `n${id}`, parentId: `n${parentIdx}` })
      if (rng() < 0.5) frontier.push(id)
      id++
    }
  }
  // If the frontier ran dry before reaching `count` (every branch happened to
  // stop early), extend a chain off the last node so the requested size is
  // still honoured.
  while (id < count) {
    data.push({ id: `n${id}`, parentId: `n${id - 1}` })
    id++
  }
  return data
}

/**
 * A general random tree: each new node attaches either to the immediately
 * preceding node (extending a chain) or to a uniformly random earlier node
 * (branching). Produces a mix of long chains and bushy fan-outs rather than
 * a perfectly balanced tree, without ever creating a cycle (every parent
 * index is strictly less than the child's).
 */
function buildRandomTree(rng: () => number, count: number): NodeData[] {
  const data: NodeData[] = [{ id: 'n0' }]
  for (let i = 1; i < count; i++) {
    const parentIdx = rng() < 0.4 ? i - 1 : Math.floor(rng() * i)
    data.push({ id: `n${i}`, parentId: `n${parentIdx}` })
  }
  return data
}

/**
 * Independently varied widths and heights, deliberately including extreme
 * aspect ratios (tall & thin, wide & short) mixed with ordinary boxes. This
 * is what drives the asymmetric contour-advance branches in `separate()` --
 * uniform sizes make `bottom(sr) === bottom(cl)` at every step and the two
 * threading branches always fire together.
 */
function buildSizes(rng: () => number, count: number): Float64Array {
  const sizes = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    const shape = rng()
    let w: number
    let h: number
    if (shape < 0.34) {
      w = 14 + rng() * 16 // tall & thin
      h = 120 + rng() * 220
    } else if (shape < 0.67) {
      w = 140 + rng() * 260 // wide & short
      h = 14 + rng() * 20
    } else {
      w = 30 + rng() * 150 // ordinary, still independently varied
      h = 24 + rng() * 90
    }
    sizes[i * 2] = w
    sizes[i * 2 + 1] = h
  }
  return sizes
}

/**
 * Full pairwise no-overlap check (not bucketed by y). Increments `counter.n`
 * for every pair actually compared, so callers can assert the loop ran.
 */
function assertNoOverlaps(
  boxes: Float64Array,
  count: number,
  counter: { n: number },
): void {
  for (let i = 0; i < count; i++) {
    const ax = boxes[i * 4]!
    const ay = boxes[i * 4 + 1]!
    const aw = boxes[i * 4 + 2]!
    const ah = boxes[i * 4 + 3]!
    for (let j = i + 1; j < count; j++) {
      const bx = boxes[j * 4]!
      const by = boxes[j * 4 + 1]!
      const bw = boxes[j * 4 + 2]!
      const bh = boxes[j * 4 + 3]!
      counter.n++
      const overlaps = ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah
      if (overlaps) {
        expect(overlaps, `boxes ${i} and ${j} have a positive-area intersection`).toBe(false)
      }
    }
  }
}

/** Every parent must sit centred over the span from its first to last child. */
function assertParentsCentered(tree: ReturnType<typeof normalize>, boxes: Float64Array): void {
  for (let i = 0; i < tree.count; i++) {
    const from = tree.childStart[i]!
    const to = tree.childStart[i + 1]!
    if (to === from) continue
    const first = tree.childIndex[from]!
    const last = tree.childIndex[to - 1]!
    const expectedCentre = (boxes[first * 4]! + boxes[last * 4]! + boxes[last * 4 + 2]!) / 2
    const actualCentre = boxes[i * 4]! + boxes[i * 4 + 2]! / 2
    expect(actualCentre).toBeCloseTo(expectedCentre, 5)
  }
}

/** Siblings (and forest roots) must be ordered left to right with spacingX respected. */
function assertSiblingOrder(
  tree: ReturnType<typeof normalize>,
  boxes: Float64Array,
  spacingX: number,
): void {
  for (let i = 0; i < tree.count; i++) {
    const from = tree.childStart[i]!
    const to = tree.childStart[i + 1]!
    for (let k = from + 1; k < to; k++) {
      const prev = tree.childIndex[k - 1]!
      const cur = tree.childIndex[k]!
      const prevRight = boxes[prev * 4]! + boxes[prev * 4 + 2]!
      expect(boxes[cur * 4]!).toBeGreaterThanOrEqual(prevRight + spacingX - 1e-6)
    }
  }
  for (let k = 1; k < tree.roots.length; k++) {
    const prev = tree.roots[k - 1]!
    const cur = tree.roots[k]!
    const prevRight = boxes[prev * 4]! + boxes[prev * 4 + 2]!
    expect(boxes[cur * 4]!).toBeGreaterThanOrEqual(prevRight + spacingX - 1e-6)
  }
}

describe('layout', () => {
  it('places a single node at the origin', () => {
    const tree = normalize([{ id: 'a' }])
    const { boxes, bounds } = layout(tree, uniformSizes(1), OPTS)
    expect(boxOf(tree, boxes, 'a')).toEqual({ x: 0, y: 0, w: 100, h: 50 })
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 })
  })

  it('stacks depth by parent height plus spacingY', () => {
    const tree = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    const { boxes } = layout(tree, uniformSizes(2), OPTS)
    expect(boxOf(tree, boxes, 'a').y).toBe(0)
    expect(boxOf(tree, boxes, 'b').y).toBe(70) // 50 height + 20 spacingY
  })

  it('separates siblings by spacingX and centres the parent over them', () => {
    const tree = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'a' },
    ])
    const { boxes } = layout(tree, uniformSizes(3), OPTS)
    const b = boxOf(tree, boxes, 'b')
    const c = boxOf(tree, boxes, 'c')
    const a = boxOf(tree, boxes, 'a')

    expect(c.x - b.x).toBe(110) // 100 width + 10 spacingX
    const childrenCentre = (b.x + c.x + c.w) / 2
    expect(a.x + a.w / 2).toBeCloseTo(childrenCentre, 6)
  })

  it('never overlaps siblings of differing widths', () => {
    const tree = normalize([
      { id: 'a' },
      { id: 'wide', parentId: 'a' },
      { id: 'narrow', parentId: 'a' },
    ])
    const sizes = uniformSizes(3)
    sizes[tree.idToIndex.get('wide')! * 2] = 300
    sizes[tree.idToIndex.get('narrow')! * 2] = 40

    const { boxes } = layout(tree, sizes, OPTS)
    const wide = boxOf(tree, boxes, 'wide')
    const narrow = boxOf(tree, boxes, 'narrow')
    expect(narrow.x).toBeGreaterThanOrEqual(wide.x + wide.w + OPTS.spacingX)
  })

  // Replaces a test that bucketed nodes by exact float `y` equality and only
  // compared within a bucket. That's fine for uniform heights (every sibling
  // at a depth shares one `y`), but the moment heights vary, almost every
  // bucket has size 1, the inner comparison loop never runs, and the test
  // passes while asserting nothing. This version does a real full pairwise
  // check, across many randomized trees with independently varied widths AND
  // heights, and asserts the comparison loop actually ran so it can never
  // silently go vacuous again.
  it('never overlaps, and always centres parents, across randomized variable-size trees', () => {
    const VARIED = { spacingX: 8, spacingY: 6 }
    const counter = { n: 0 }
    let seed = 1

    for (let trial = 0; trial < 300; trial++) {
      // Deterministic seed progression -- a failure is reproducible by
      // re-running with `trial` fixed, no external state involved.
      seed = (seed * 2654435761 + trial) >>> 0
      const rng = mulberry32(seed)
      const shape = trial % 3
      const data =
        shape === 0
          ? buildBrushTree(rng, 6 + Math.floor(rng() * 10), 25)
          : shape === 1
            ? buildRandomTree(rng, 40 + Math.floor(rng() * 120))
            : buildBushyTree(rng, 40 + Math.floor(rng() * 120))

      const tree = normalize(data)
      const sizes = buildSizes(rng, tree.count)
      const { boxes } = layout(tree, sizes, VARIED)

      assertNoOverlaps(boxes, tree.count, counter)
      assertParentsCentered(tree, boxes)
      assertSiblingOrder(tree, boxes, VARIED.spacingX)
    }

    // Guards against this test silently going vacuous again: if the pairwise
    // loop above never actually executed, fail loudly instead of passing on
    // an empty assertion set.
    expect(counter.n).toBeGreaterThan(0)
  })

  it('lays out a forest without overlapping the roots', () => {
    const tree = normalize([{ id: 'a' }, { id: 'b' }])
    const { boxes } = layout(tree, uniformSizes(2), OPTS)
    const a = boxOf(tree, boxes, 'a')
    const b = boxOf(tree, boxes, 'b')
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.w + OPTS.spacingX)
  })

  // The previous forest coverage was two bare single-node roots -- it never
  // reached the contour loop at all. This exercises multiple roots of
  // unequal depth, each with a multi-level subtree.
  it('lays out a forest with roots of unequal depth without overlaps', () => {
    const data: NodeData[] = [
      { id: 'r0' }, // lone root, no children
      { id: 'r1' },
      { id: 'r1-a', parentId: 'r1' },
      { id: 'r1-b', parentId: 'r1' },
      { id: 'r1-a-x', parentId: 'r1-a' },
      { id: 'r2' },
      { id: 'r2-a', parentId: 'r2' },
      { id: 'r2-a-x', parentId: 'r2-a' },
      { id: 'r2-a-x-y', parentId: 'r2-a-x' },
      { id: 'r2-a-x-y-z', parentId: 'r2-a-x-y' },
    ]
    const tree = normalize(data)
    const sizes = new Float64Array(tree.count * 2)
    for (let i = 0; i < tree.count; i++) {
      sizes[i * 2] = 60 + ((i * 17) % 90)
      sizes[i * 2 + 1] = 30 + ((i * 23) % 70)
    }
    const { boxes } = layout(tree, sizes, OPTS)

    const counter = { n: 0 }
    assertNoOverlaps(boxes, tree.count, counter)
    expect(counter.n).toBeGreaterThan(0)
    assertParentsCentered(tree, boxes)
    assertSiblingOrder(tree, boxes, OPTS.spacingX)
  })

  it('returns empty bounds for empty input', () => {
    const tree = normalize([])
    const { boxes, bounds } = layout(tree, new Float64Array(0), OPTS)
    expect(boxes.length).toBe(0)
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })

  it('survives a 50k-deep chain without a stack overflow', () => {
    const data = Array.from({ length: 50_000 }, (_, i) => ({
      id: `n${i}`,
      ...(i === 0 ? {} : { parentId: `n${i - 1}` }),
    }))
    const tree = normalize(data)
    const { boxes } = layout(tree, uniformSizes(tree.count), OPTS)
    expect(boxes[(50_000 - 1) * 4 + 1]).toBe(49_999 * 70)

    // A single-child chain never triggers separation (no node ever has a
    // sibling), so every node's x must stay at the origin. Assert that too,
    // so this is an actual layout (x AND y) test, not just a depth check.
    let maxAbsX = 0
    for (let i = 0; i < tree.count; i++) {
      const absX = Math.abs(boxes[i * 4]!)
      if (absX > maxAbsX) maxAbsX = absX
    }
    expect(maxAbsX).toBe(0)
  })

  // C1 regression: a NaN anywhere in `sizes` (bad height, out-of-range
  // typed-array read, NaN spacingY) used to make both the `sy <= cy` and
  // `sy >= cy` contour-advance checks in `separate()` false simultaneously,
  // so neither pointer ever moved and the `while` loop spun forever -- a
  // hard hang with no stack, fatal inside a Web Worker. The real guarantee
  // against that is the structural fix in `separate()` (the `!(sy < cy)`
  // rewrite, see its comment) -- that's what makes this loop terminate at
  // all. The explicit timeout below is only a backstop against a slow
  // regression, not a hanging one: Vitest cannot interrupt synchronous code,
  // so against a genuine infinite loop the worker just wedges and the
  // timeout never fires. It's kept anyway because it's harmless and does
  // catch the case where a future change makes this measurably slower
  // without actually hanging.
  it(
    'returns instead of hanging when sizes contains NaN',
    () => {
      const tree = normalize([
        { id: 'a' },
        { id: 'b', parentId: 'a' },
        { id: 'c', parentId: 'a' },
      ])
      const sizes = new Float64Array([50, 20, 50, NaN, 50, 20])
      const { boxes } = layout(tree, sizes, { spacingX: 5, spacingY: 5 })
      expect(boxes.length).toBe(tree.count * 4)
    },
    2000,
  )
})
