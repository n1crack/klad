import { describe, expect, it } from 'vitest'
import { normalize } from './tree.js'
import { toWireTree } from './worker/protocol.js'
import { createChartEngine } from './engine.js'
import { buildQuadTree } from './spatial/quadtree.js'
import { visibleRect } from './viewport.js'
import { layout } from './layout/tidy.js'
import type { Renderer } from './render/renderer.js'
import type { NodeData } from './types.js'

// See tidy.bench.test.ts for why this is a bare module-scoped `declare const`
// rather than `declare global`.
declare const performance: { now: () => number }
// Same reasoning as `performance` above: a bare module-scoped `declare const`,
// never `declare global`, so this stays confined to this test file.
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

function noopRenderer(): Renderer {
  return {
    resize: () => {},
    draw: () => {},
    stats: { lastDrawCalls: { edgeStrokes: 0, nodes: 0, labels: 0 } },
  }
}

/**
 * Simulates a horizontal+vertical pan: `frames` calls to `render()`, each with
 * a new camera position, after a relayout and a short warm-up so JIT
 * compilation doesn't dominate the measured average.
 */
function panBench(count: number, frames: number): number {
  const engine = createChartEngine(noopRenderer())
  const tree = normalize(buildTree(count))
  const sizes = new Float64Array(tree.count * 2)
  for (let i = 0; i < tree.count; i++) {
    sizes[i * 2] = 160 + (i % 7) * 24
    sizes[i * 2 + 1] = 48 + (i % 11) * 12
  }
  const labels: string[] = Array.from({ length: tree.count }, () => '')
  engine.setViewport(1600, 900, 1)
  engine.setData(toWireTree(tree), sizes, labels, new Uint8Array(tree.count).fill(1))
  engine.setCamera({ x: 0, y: 0, k: 1 })
  engine.render() // triggers relayout; excluded from the pan average

  for (let i = 0; i < 15; i++) {
    engine.setCamera({ x: -i * 20, y: -i * 4, k: 1 })
    engine.render()
  }

  const start = performance.now()
  for (let i = 0; i < frames; i++) {
    engine.setCamera({ x: -i * 15, y: -i * 3, k: 1 })
    engine.render()
  }
  return (performance.now() - start) / frames
}

/**
 * Times `quad.query` alone, at the same scale, bypassing the engine entirely.
 * Isolates the spatial-index cost from allocation/translation/draw so the
 * two can be compared directly.
 */
function queryOnlyBench(count: number, frames: number): number {
  const tree = normalize(buildTree(count))
  const sizes = new Float64Array(tree.count * 2)
  for (let i = 0; i < tree.count; i++) {
    sizes[i * 2] = 160 + (i % 7) * 24
    sizes[i * 2 + 1] = 48 + (i % 11) * 12
  }
  const result = layout(tree, sizes, { spacingX: 16, spacingY: 48 })
  const quad = buildQuadTree(result.boxes, result.bounds)
  const out = new Uint32Array(tree.count)
  const camera = { x: 0, y: 0, k: 1 }
  const viewport = { width: 1600, height: 900 }

  for (let i = 0; i < 15; i++) {
    quad.query(visibleRect({ ...camera, x: -i * 20 }, viewport), out)
  }

  const start = performance.now()
  for (let i = 0; i < frames; i++) {
    quad.query(visibleRect({ ...camera, x: -i * 15, y: -i * 3 }, viewport), out)
  }
  return (performance.now() - start) / frames
}

/**
 * Times only "allocate a fresh Uint32Array and copy `n` translated indices
 * into it" — the shape of `render()`'s per-frame `drawn` construction — in
 * isolation, to see how much of the per-frame budget that allocation alone
 * could plausibly cost.
 */
function allocTranslateBench(n: number, frames: number): number {
  const source = new Int32Array(n)
  for (let i = 0; i < n; i++) source[i] = i * 2
  const idx = new Uint32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i

  const start = performance.now()
  for (let f = 0; f < frames; f++) {
    const drawn = new Uint32Array(n)
    for (let i = 0; i < n; i++) drawn[i] = source[idx[i]!]!
    if (drawn.length !== n) throw new Error('unreachable')
  }
  return (performance.now() - start) / frames
}

describe('engine pan performance (bench, informational)', () => {
  it('reports per-frame render() cost while panning a 5,000-node chart', () => {
    const avg = panBench(5_000, 180)
    console.log(`[bench] engine.render() avg, 5,000 nodes: ${avg.toFixed(4)}ms/frame`)
    expect(avg).toBeLessThan(16)
  })

  it('reports per-frame render() cost while panning a 20,000-node chart', () => {
    const avg = panBench(20_000, 180)
    console.log(`[bench] engine.render() avg, 20,000 nodes: ${avg.toFixed(4)}ms/frame`)
    expect(avg).toBeLessThan(16)
  })

  it('reports quad.query() cost alone at the same scales', () => {
    const avg5k = queryOnlyBench(5_000, 180)
    const avg20k = queryOnlyBench(20_000, 180)
    console.log(`[bench] quad.query() avg, 5,000 nodes: ${avg5k.toFixed(4)}ms/frame`)
    console.log(`[bench] quad.query() avg, 20,000 nodes: ${avg20k.toFixed(4)}ms/frame`)
    expect(avg5k).toBeLessThan(16)
    expect(avg20k).toBeLessThan(16)
  })

  it('reports the cost of a fresh per-frame Uint32Array at realistic visible-set sizes', () => {
    for (const n of [200, 1_000, 4_000]) {
      const avg = allocTranslateBench(n, 500)
      console.log(`[bench] alloc+translate avg, ${n} visible: ${avg.toFixed(5)}ms/frame`)
    }
    expect(true).toBe(true)
  })
})
