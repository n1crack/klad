import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { layout } from './tidy.js'
import type { NodeData } from '../types.js'

// `performance` is available in browsers, Web Workers, and Node, but this
// package's tsconfig sets `types: []` (no @types/node) and `lib: ["ES2023"]`
// (no DOM) to keep DOM/Node leakage out of runtime code, so TS doesn't know
// about it. Declare just the shape this test needs.
//
// Deliberately NOT `declare global { ... }`: `declare global` augments the
// global scope of the entire compilation, not just this file. Since this
// package's tsconfig includes all of `src` (test files live alongside
// runtime code), a `declare global` here would make `performance` resolvable
// from every module in the package — including tidy.ts — defeating the very
// `types: []` guard this comment is talking about. A bare `declare const`
// inside a module is module-scoped, emits nothing, and still resolves to the
// host global at runtime; it does not leak into other files.
declare const performance: { now: () => number }

/**
 * Builds a 50k-node tree: a bushy branching-factor-10 core (root + up to five
 * levels: 1 + 10 + 100 + 1,000 + 10,000 + a partial next level = 40,000
 * nodes), then variable-length chains (1..37 nodes each) hung off a rotating
 * subset of that core's leaves for the remaining 10,000 nodes.
 *
 * The uniform bushy-only shape this replaced put every sibling at a given
 * depth at the exact same y (uniform heights, uniform depth), so
 * `bottom(sr) === bottom(cl)` at every contour step in `separate()` and the
 * two threading branches (`sy <= cy` / `!(sy < cy)`) always advanced
 * together -- the benchmark never actually exercised the tl/tr thread-setup
 * paths, only the cheapest lock-step case. Chaining unequal-length runs off
 * sibling leaves means neighbouring subtrees now bottom out at different
 * depths, which is what drives contours out of lock-step and forces real
 * threading.
 */
function build50k(): NodeData[] {
  const data: NodeData[] = [{ id: 'root' }]
  let frontier = ['root']
  while (data.length < 40_000) {
    const next: string[] = []
    for (const parentId of frontier) {
      for (let i = 0; i < 10 && data.length < 40_000; i++) {
        const id = `${parentId}.${i}`
        data.push({ id, parentId })
        next.push(id)
      }
    }
    frontier = next
  }

  // Hang variable-length chains off a rotating subset of the bushy tree's
  // current frontier so depth is unequal across sibling subtrees. `idx`
  // advances deterministically, so this is reproducible without Math.random.
  let idx = 0
  while (data.length < 50_000) {
    const leaf = frontier[idx % frontier.length]!
    const chainLen = (idx % 37) + 1
    let prev = `${leaf}.chain${idx}`
    data.push({ id: prev, parentId: leaf })
    for (let c = 1; c < chainLen && data.length < 50_000; c++) {
      const id = `${prev}.c${c}`
      data.push({ id, parentId: prev })
      prev = id
    }
    idx++
  }
  return data
}

describe('layout performance budget', () => {
  it('lays out 50k nodes in under 400ms', () => {
    const tree = normalize(build50k())
    const sizes = new Float64Array(tree.count * 2)
    for (let i = 0; i < tree.count; i++) {
      // Varied width/height (not the uniform 220x96 this replaced) so the
      // benchmark's timing reflects the non-layered, variable-size path
      // rather than the uniform-row shortcut.
      sizes[i * 2] = 160 + (i % 7) * 24
      sizes[i * 2 + 1] = 48 + (i % 11) * 12
    }

    // Warm up so the measured run is not dominated by first-call JIT compilation.
    layout(tree, sizes, { spacingX: 16, spacingY: 48 })

    const start = performance.now()
    layout(tree, sizes, { spacingX: 16, spacingY: 48 })
    const elapsed = performance.now() - start

    expect(tree.count).toBe(50_000)
    expect(elapsed).toBeLessThan(400)
  })
})
