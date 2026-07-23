import { describe, expect, it, vi } from 'vitest'
import { createChartEngine } from './engine.js'
import { toWireTree } from './worker/protocol.js'
import { normalize } from './tree.js'
import { toSVG } from './render/svg.js'
import type { Renderer } from './render/renderer.js'

/**
 * Dedicated file (not engine.test.ts) so this doesn't collide with sibling
 * work on that file's ring-flash tests — it exercises exactly one thing:
 * `ChartEngine.getExportData()`, the export entry point added to engine.ts
 * for render/svg.ts to consume.
 */

function fakeRenderer(): Renderer {
  return {
    resize: vi.fn(),
    draw: vi.fn(),
    setTheme: vi.fn(),
    stats: { lastDrawCalls: { edgeStrokes: 0, nodes: 0, labels: 0 } },
  }
}

const DATA = [
  { id: 'a' },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: 'a' },
]

function sizesFor(count: number, w = 100, h = 50): Float64Array {
  const s = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    s[i * 2] = w
    s[i * 2 + 1] = h
  }
  return s
}

describe('ChartEngine.getExportData', () => {
  it('reflects the full visible tree, independent of camera/viewport', () => {
    const engine = createChartEngine(fakeRenderer())
    const tree = normalize(DATA)
    // Deliberately no setViewport call, and a camera left at its default —
    // export must not depend on either: it forces a relayout on its own
    // (like hitTest) and covers the whole pruned tree regardless of what a
    // viewport-based render() would cull.
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['A', 'B', 'C', 'D'], new Uint8Array(tree.count).fill(1))

    const data = engine.getExportData()
    expect(data.parent.length).toBe(tree.count)
    expect(data.boxes.length).toBe(tree.count * 4)
    expect(data.labels).toEqual(['A', 'B', 'C', 'D'])
    expect(data.horizontal).toBe(false)

    // The export snapshot is real layout output, not placeholder zeros — and
    // it round-trips into a well-formed, non-empty SVG document.
    const svg = toSVG(data)
    expect(svg.startsWith('<svg')).toBe(true)
    expect((svg.match(/<rect/g) ?? []).length).toBe(tree.count)
  })

  it('excludes collapsed branches, matching the design\'s "visible tree, not viewport" rule', () => {
    const engine = createChartEngine(fakeRenderer())
    const tree = normalize(DATA)
    // Start fully open, then collapse 'b' — its child 'c' must disappear
    // from the export the same way it disappears from the on-screen tree.
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['A', 'B', 'C', 'D'], new Uint8Array(tree.count).fill(1))
    const bIndex = tree.idToIndex.get('b')!
    engine.setOpen(bIndex, false)

    const data = engine.getExportData()
    expect(data.labels).toEqual(['A', 'B', 'D'])
    expect(data.parent.length).toBe(3)
  })

  it('reports horizontal=true for lr/rl orientation, matching Frame.horizontal', () => {
    const engine = createChartEngine(fakeRenderer())
    const tree = normalize(DATA)
    engine.setOptions({ orientation: 'lr' })
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['A', 'B', 'C', 'D'], new Uint8Array(tree.count).fill(1))

    expect(engine.getExportData().horizontal).toBe(true)
  })
})
