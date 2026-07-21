import { describe, expect, it, vi } from 'vitest'
import { createChartEngine } from './engine.js'
import { toWireTree, wireTreeToTree } from './worker/protocol.js'
import { normalize } from './tree.js'
import type { Frame, Renderer } from './render/renderer.js'

function fakeRenderer(): Renderer & { frames: Frame[] } {
  const frames: Frame[] = []
  return {
    frames,
    resize: vi.fn(),
    draw: (f: Frame) => {
      // Copy the parts assertions read; the engine reuses its buffers.
      frames.push({ ...f, visible: f.visible.slice(0, f.visibleCount) })
    },
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

function seed(renderer: Renderer) {
  const engine = createChartEngine(renderer)
  const tree = normalize(DATA)
  engine.setViewport(800, 600, 1)
  engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b', 'c', 'd'], new Uint8Array(tree.count).fill(1))
  return { engine, tree }
}

describe('toWireTree / wireTreeToTree', () => {
  it('round-trips the structural arrays', () => {
    const tree = normalize(DATA)
    const back = wireTreeToTree(toWireTree(tree))
    expect(back.count).toBe(tree.count)
    expect(Array.from(back.parent)).toEqual(Array.from(tree.parent))
    expect(Array.from(back.childIndex)).toEqual(Array.from(tree.childIndex))
    expect(Array.from(back.order)).toEqual(Array.from(tree.order))
  })
})

describe('ChartEngine', () => {
  it('lays out and draws every node when all are open', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    expect(renderer.frames.at(-1)!.visibleCount).toBe(4)
  })

  it('drops descendants of a closed node from the drawn set', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setOpen(tree.idToIndex.get('b')!, false)
    engine.render()
    expect(renderer.frames.at(-1)!.visibleCount).toBe(3)
  })

  it('culls to the viewport instead of drawing everything', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    // Push the whole chart far off screen.
    engine.setCamera({ x: -100_000, y: -100_000, k: 1 })
    engine.render()
    expect(renderer.frames.at(-1)!.visibleCount).toBe(0)
  })

  it('returns the source indices of what it drew', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setOpen(tree.idToIndex.get('b')!, false)
    const drawn = Array.from(engine.render()).sort((p, q) => p - q)
    expect(drawn).toEqual([
      tree.idToIndex.get('a')!,
      tree.idToIndex.get('b')!,
      tree.idToIndex.get('d')!,
    ])
  })

  it('does not relayout on a camera change', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes.slice()
    engine.setCamera({ x: 37, y: -12, k: 2 })
    engine.render()
    expect(Array.from(engine.boxes)).toEqual(Array.from(before))
  })

  it('relayouts when the orientation changes', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes.slice()
    engine.setOptions({ orientation: 'lr' })
    engine.render()
    expect(Array.from(engine.boxes)).not.toEqual(Array.from(before))
  })

  it('picks the LOD tier from the camera zoom', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 0.1 })
    engine.render()
    expect(renderer.frames.at(-1)!.tier).toBe('block')
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    expect(renderer.frames.at(-1)!.tier).toBe('full')
  })

  it('hit-tests in world coordinates and reports the source index', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const rootIndex = tree.idToIndex.get('a')!
    // The root is centred over its children, so it is NOT guaranteed to sit at
    // the layout origin (only the leftmost node is). Read its actual box back
    // out of the pruned buffer and hit-test its centre instead of assuming a
    // fixed point.
    const pruned = Array.from(engine.visibleToSource).indexOf(rootIndex)
    const cx = engine.boxes[pruned * 4]! + engine.boxes[pruned * 4 + 2]! / 2
    const cy = engine.boxes[pruned * 4 + 1]! + engine.boxes[pruned * 4 + 3]! / 2
    expect(engine.hitTest(cx, cy)).toBe(rootIndex)
    expect(engine.hitTest(-500, -500)).toBe(-1)
  })

  it('maps highlight ids onto the drawn frame', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setHighlight(Uint32Array.from([tree.idToIndex.get('d')!]))
    engine.render()
    const frame = renderer.frames.at(-1)!
    expect(frame.highlight).not.toBeNull()
    expect(frame.highlight!.some((v) => v === 1)).toBe(true)
  })

  it('survives an empty dataset', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    engine.setViewport(800, 600, 1)
    engine.setData(toWireTree(normalize([])), new Float64Array(0), [], new Uint8Array(0))
    engine.setCamera({ x: 0, y: 0, k: 1 })
    expect(() => engine.render()).not.toThrow()
    expect(renderer.frames.at(-1)!.visibleCount).toBe(0)
  })
})
