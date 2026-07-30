import { describe, expect, it } from 'vitest'
import { normalize } from './tree.js'
import { layout } from './layout/tidy.js'
import { computeSilhouette } from './minimap.js'
import type { NodeData } from './types.js'

// See tidy.bench.test.ts for why this is a bare module-scoped `declare const`
// rather than `declare global`.
declare const performance: { now: () => number }
declare const console: { log: (...args: unknown[]) => void }

/** Branching-factor-8 tree of exactly `count` nodes (root included). */
function buildTree(count: number): NodeData[] {
  const data: NodeData[] = [{ id: 'root' }]
  let frontier = ['root']
  while (data.length < count) {
    const next: string[] = []
    for (const parentId of frontier) {
      for (let i = 0; i < 8 && data.length < count; i++) {
        const id = `${parentId}.${i}`
        data.push({ id, parentId })
        next.push(id)
      }
    }
    frontier = next
  }
  return data
}

describe('minimap silhouette performance budget (bench, informational)', () => {
  it('rasterizes a 50,000-node silhouette in a few milliseconds', () => {
    const tree = normalize(buildTree(50_000))
    const sizes = new Float64Array(tree.count * 2)
    for (let i = 0; i < tree.count; i++) {
      sizes[i * 2] = 160 + (i % 7) * 24
      sizes[i * 2 + 1] = 48 + (i % 11) * 12
    }
    const { boxes, bounds } = layout(tree, sizes, { spacingX: 16, spacingY: 48 })
    const size = { width: 240, height: 160 }

    // Warm up so the measured run is not dominated by first-call JIT compilation.
    computeSilhouette(boxes, bounds, size)

    const start = performance.now()
    const result = computeSilhouette(boxes, bounds, size)
    const elapsed = performance.now() - start

    console.log(`[bench] computeSilhouette avg, 50,000 nodes, 240x160 grid: ${elapsed.toFixed(4)}ms`)
    expect(result.width).toBe(240)
    expect(result.height).toBe(160)
    expect(elapsed).toBeLessThan(50)
  })

  it('cost is dominated by node count and grid size, independent of per-box footprint', () => {
    // A handful of huge boxes, each covering roughly half the grid, is the
    // pathological case a naive per-cell-loop rasterizer would choke on
    // (O(nodes * pixels)); the difference-array approach should still be fast.
    const tree = normalize(buildTree(5_000))
    const sizes = new Float64Array(tree.count * 2)
    for (let i = 0; i < tree.count; i++) {
      // Deliberately oversized relative to spacing so boxes overlap heavily
      // once mapped onto a small grid.
      sizes[i * 2] = 4_000
      sizes[i * 2 + 1] = 2_000
    }
    const { boxes, bounds } = layout(tree, sizes, { spacingX: 4, spacingY: 4 })
    const size = { width: 240, height: 160 }

    computeSilhouette(boxes, bounds, size)
    const start = performance.now()
    computeSilhouette(boxes, bounds, size)
    const elapsed = performance.now() - start

    console.log(`[bench] computeSilhouette avg, 5,000 giant overlapping boxes: ${elapsed.toFixed(4)}ms`)
    expect(elapsed).toBeLessThan(50)
  })
})
