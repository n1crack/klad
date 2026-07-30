import type { Bounds } from '../types.js'

export interface QuadTree {
  /**
   * Writes the indices of every box overlapping `rect` into `out`.
   * Returns the number written; stops early when `out` is full.
   *
   * Box edges are inclusive on the top-left, exclusive on the bottom-right.
   * A zero-area box (width or height 0) can still satisfy the strict overlap
   * test used here and be returned by `query`, even though the same box can
   * never be returned by `hitTest` (see below) — this is a consequence of
   * the half-open edge convention, not a bug.
   */
  query(rect: Bounds, out: Uint32Array): number
  /**
   * Returns the index of the topmost (highest-index) box containing the
   * point, or -1. Box edges are inclusive on the top-left, exclusive on the
   * bottom-right, so a zero-area box can never contain any point.
   */
  hitTest(x: number, y: number): number
}

interface Quad {
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Boxes that do not fit in any child quad. */
  items: number[]
  /** Child quads in NW, NE, SW, SE order; empty when this is a leaf. */
  children: Quad[]
}

const SPLIT_THRESHOLD = 8

function makeQuad(minX: number, minY: number, maxX: number, maxY: number): Quad {
  return { minX, minY, maxX, maxY, items: [], children: [] }
}

function split(quad: Quad): void {
  const midX = (quad.minX + quad.maxX) / 2
  const midY = (quad.minY + quad.maxY) / 2
  quad.children = [
    makeQuad(quad.minX, quad.minY, midX, midY),
    makeQuad(midX, quad.minY, quad.maxX, midY),
    makeQuad(quad.minX, midY, midX, quad.maxY),
    makeQuad(midX, midY, quad.maxX, quad.maxY),
  ]
}

/** Returns the child that fully contains the box, or -1. */
function childFor(quad: Quad, x0: number, y0: number, x1: number, y1: number): number {
  for (let c = 0; c < 4; c++) {
    const q = quad.children[c]!
    if (x0 >= q.minX && x1 <= q.maxX && y0 >= q.minY && y1 <= q.maxY) return c
  }
  return -1
}

/**
 * Builds a region quadtree over `boxes`, storing each box in the deepest quad
 * that fully contains it. `maxDepth` bounds the tree's depth: a lower cap
 * trades query time for memory (and, in the extreme, at `maxDepth = 0` the
 * tree degrades to a single bucket and every query is a linear scan).
 *
 * `bounds` need not contain every box. Boxes that fall outside `bounds` are
 * kept at the root rather than dropped — see the root-is-unbounded handling
 * in `query`/`hitTest` below — but `bounds` still drives where the interior
 * split lines fall, so layouts should still pass a bounds that tightly
 * wraps their boxes for good culling performance.
 */
export function buildQuadTree(boxes: Float64Array, bounds: Bounds, maxDepth = 12): QuadTree {
  const count = Math.floor(boxes.length / 4)
  const root = makeQuad(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)

  for (let i = 0; i < count; i++) {
    const o = i * 4
    const x0 = boxes[o]!
    const y0 = boxes[o + 1]!
    const x1 = x0 + boxes[o + 2]!
    const y1 = y0 + boxes[o + 3]!

    let quad = root
    let depth = 0
    for (;;) {
      if (quad.children.length === 0) {
        if (quad.items.length < SPLIT_THRESHOLD || depth >= maxDepth) break
        split(quad)
        // Re-home the existing items now that children exist.
        const stay: number[] = []
        for (const item of quad.items) {
          const io = item * 4
          const c = childFor(
            quad,
            boxes[io]!,
            boxes[io + 1]!,
            boxes[io]! + boxes[io + 2]!,
            boxes[io + 1]! + boxes[io + 3]!,
          )
          if (c === -1) stay.push(item)
          else quad.children[c]!.items.push(item)
        }
        quad.items = stay
      }
      const c = childFor(quad, x0, y0, x1, y1)
      if (c === -1) break
      quad = quad.children[c]!
      depth++
    }
    quad.items.push(i)
  }

  const overlaps = (i: number, minX: number, minY: number, maxX: number, maxY: number): boolean => {
    const o = i * 4
    const x0 = boxes[o]!
    const y0 = boxes[o + 1]!
    return x0 < maxX && x0 + boxes[o + 2]! > minX && y0 < maxY && y0 + boxes[o + 3]! > minY
  }

  const contains = (i: number, x: number, y: number): boolean => {
    const o = i * 4
    const x0 = boxes[o]!
    const y0 = boxes[o + 1]!
    return x >= x0 && x < x0 + boxes[o + 2]! && y >= y0 && y < y0 + boxes[o + 3]!
  }

  // Reused across calls so neither query nor hitTest allocates per frame.
  const stack: Quad[] = []

  return {
    query(rect: Bounds, out: Uint32Array): number {
      let written = 0
      stack.length = 0
      stack.push(root)
      while (stack.length > 0) {
        const quad = stack.pop()!
        // The root can hold boxes that don't fit inside `bounds` (see
        // buildQuadTree above), so it violates its own containment
        // invariant and must never be rejected by the rect test below —
        // only its children, which are genuinely bounded, may be culled.
        if (
          quad !== root &&
          (quad.minX >= rect.maxX ||
            quad.maxX <= rect.minX ||
            quad.minY >= rect.maxY ||
            quad.maxY <= rect.minY)
        ) {
          continue
        }
        for (const item of quad.items) {
          if (!overlaps(item, rect.minX, rect.minY, rect.maxX, rect.maxY)) continue
          if (written >= out.length) return written
          out[written++] = item
        }
        for (const child of quad.children) stack.push(child)
      }
      return written
    },

    hitTest(x: number, y: number): number {
      let best = -1
      stack.length = 0
      stack.push(root)
      while (stack.length > 0) {
        const quad = stack.pop()!
        // Same root-is-unbounded reasoning as in query: only reject a
        // non-root quad on the point-containment test.
        if (quad !== root && (x < quad.minX || x >= quad.maxX || y < quad.minY || y >= quad.maxY)) {
          continue
        }
        for (const item of quad.items) {
          if (item > best && contains(item, x, y)) best = item
        }
        for (const child of quad.children) stack.push(child)
      }
      return best
    },
  }
}
