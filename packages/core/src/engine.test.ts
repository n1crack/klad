import { describe, expect, it, vi } from 'vitest'
import { createChartEngine } from './engine.js'
import { toWireTree, wireTreeToTree } from './worker/protocol.js'
import { normalize } from './tree.js'
import type { Frame, Renderer } from './render/renderer.js'
import type { NodeData } from './types.js'

function fakeRenderer(): Renderer & { frames: Frame[] } {
  const frames: Frame[] = []
  return {
    frames,
    resize: vi.fn(),
    draw: (f: Frame) => {
      // Deep-copy every buffer the engine reuses in place across frames. A
      // shallow copy of just `visible` would let two captured frames share
      // `highlight` (the engine's own `highlightBuffer`, mutated in place),
      // `boxes`, or `parent` — the first test comparing one of those across
      // renders would silently compare a buffer against itself.
      //
      // `visible` and `edges` are independent engine-owned buffers (see
      // renderer.ts's `Frame.edges` docblock) — each sliced to its OWN count,
      // not each other's, or a defect-1/defect-2 regression test would
      // silently read the wrong array's stale tail.
      frames.push({
        ...f,
        boxes: f.boxes.slice(),
        parent: f.parent.slice(),
        visible: f.visible.slice(0, f.visibleCount),
        edges: f.edges.slice(0, f.edgeCount),
        labels: f.labels.slice(),
        camera: { ...f.camera },
        highlight: f.highlight === null ? null : f.highlight.slice(),
        // Same reasoning: `revealAlpha`/`ghostBoxes`/`ghostAlpha` are also
        // engine-owned buffers reused (and grown) across frames.
        revealAlpha: f.revealAlpha === null ? null : f.revealAlpha.slice(0, f.visibleCount),
        ghostBoxes: f.ghostBoxes.slice(0, f.ghostCount * 4),
        ghostAlpha: f.ghostAlpha.slice(0, f.ghostCount),
      })
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
    expect(Array.from(back.childStart)).toEqual(Array.from(tree.childStart))
    expect(Array.from(back.childIndex)).toEqual(Array.from(tree.childIndex))
    expect(Array.from(back.roots)).toEqual(Array.from(tree.roots))
    expect(Array.from(back.depth)).toEqual(Array.from(tree.depth))
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
    // Guard the index before using it: if a regression ever dropped the root
    // from the pruned set, `pruned` would be -1 and `engine.boxes[-4]` would
    // read `undefined`, producing a confusing NaN comparison below instead of
    // a clean assertion failure here.
    expect(pruned).toBeGreaterThanOrEqual(0)
    const cx = engine.boxes[pruned * 4]! + engine.boxes[pruned * 4 + 2]! / 2
    const cy = engine.boxes[pruned * 4 + 1]! + engine.boxes[pruned * 4 + 3]! / 2
    expect(engine.hitTest(cx, cy)).toBe(rootIndex)
    expect(engine.hitTest(-500, -500)).toBe(-1)
  })

  it('hit-tests correctly even before the first render()', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    // Nothing has been laid out yet — hitTest must trigger its own relayout
    // rather than assuming render() already ran.
    expect(engine.visibleToSource.length).toBe(0)
    expect(engine.hitTest(-999_999, -999_999)).toBe(-1)
    expect(engine.visibleToSource.length).toBe(4)
  })

  it('maps highlight ids onto the drawn frame', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    const dIndex = tree.idToIndex.get('d')!
    engine.setHighlight(Uint32Array.from([dIndex]))
    engine.render()
    const frame = renderer.frames.at(-1)!
    expect(frame.highlight).not.toBeNull()
    // Assert the exact array, derived independently from visibleToSource, not
    // just "some entry is set" — index-space translation (source -> pruned)
    // is the highest-risk behaviour in this file, and a wrong-node highlight
    // would still satisfy a `.some(v => v === 1)` check.
    const expected = Array.from(engine.visibleToSource).map((src) => (src === dIndex ? 1 : 0))
    expect(Array.from(frame.highlight!)).toEqual(expected)
  })

  it('clears highlight when setHighlight(null) is called', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setHighlight(Uint32Array.from([tree.idToIndex.get('a')!]))
    engine.render()
    expect(renderer.frames.at(-1)!.highlight).not.toBeNull()
    engine.setHighlight(null)
    engine.render()
    expect(renderer.frames.at(-1)!.highlight).toBeNull()
  })

  it('reports the dragged node in pruned index space via dragIndex', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    const dIndex = tree.idToIndex.get('d')!
    engine.setDrag(dIndex)
    engine.render()
    const frame = renderer.frames.at(-1)!
    expect(frame.dragIndex).not.toBe(-1)
    expect(engine.visibleToSource[frame.dragIndex]).toBe(dIndex)
  })

  it('reports dragIndex -1 when nothing is being dragged', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    expect(renderer.frames.at(-1)!.dragIndex).toBe(-1)
  })

  it('exposes bounds reflecting the last layout', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    expect(engine.bounds.maxX).toBeGreaterThan(engine.bounds.minX)
    expect(engine.bounds.maxY).toBeGreaterThan(engine.bounds.minY)
  })

  it('mirrors the layout horizontally when rtl is set', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes.slice()
    engine.setOptions({ rtl: true })
    engine.render()
    expect(Array.from(engine.boxes)).not.toEqual(Array.from(before))
  })

  it('ignores an out-of-range setOpen index', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes
    expect(() => engine.setOpen(-1, false)).not.toThrow()
    expect(() => engine.setOpen(999, false)).not.toThrow()
    engine.render()
    expect(engine.boxes).toBe(before)
  })

  it('renders zero visible nodes before setViewport is called', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const tree = normalize(DATA)
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b', 'c', 'd'], new Uint8Array(tree.count).fill(1))
    engine.setCamera({ x: 0, y: 0, k: 1 })
    expect(() => engine.render()).not.toThrow()
    expect(renderer.frames.at(-1)!.visibleCount).toBe(0)
  })

  it('forwards viewport changes to the renderer', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    engine.setViewport(640, 480, 2)
    expect(renderer.resize).toHaveBeenCalledWith(640, 480, 2)
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

// F1: setOptions/setOpen must dirty the layout only on an actual
// layout-affecting change. `layout()` always allocates a fresh `boxes`, so
// reference identity across renders is a reliable "did it relayout" probe.
describe('ChartEngine dirty tracking (F1)', () => {
  it('does not relayout when only lod changes', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes
    engine.setOptions({ lod: { text: 0.5, overlay: 0.9 } })
    engine.render()
    expect(engine.boxes).toBe(before)
  })

  it('does not relayout on a no-op orientation set', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes
    engine.setOptions({ orientation: 'tb' }) // already 'tb' — DEFAULT_OPTIONS
    engine.render()
    expect(engine.boxes).toBe(before)
  })

  it('does not relayout when setOpen sets an already-open node', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes
    engine.setOpen(tree.idToIndex.get('b')!, true) // seed() opens every node already
    engine.render()
    expect(engine.boxes).toBe(before)
  })

  it('relayouts (fresh boxes) when a layout-affecting option actually changes', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes
    engine.setOptions({ spacingX: 999 })
    engine.render()
    expect(engine.boxes).not.toBe(before)
  })

  it('relayouts (fresh boxes) when setOpen actually flips a flag', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes
    engine.setOpen(tree.idToIndex.get('b')!, false)
    engine.render()
    expect(engine.boxes).not.toBe(before)
  })
})

// F2: setData/setCamera must defensive-copy every caller-owned buffer at the
// boundary. In the worker path these arrive as structured clones the engine
// already owns; in the main-thread fallback the host still owns the object,
// so aliasing it is a route for the two transports to disagree.
describe('ChartEngine caller-owned buffer aliasing (F2)', () => {
  it('does not write through into the caller-owned open array', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const tree = normalize(DATA)
    engine.setViewport(800, 600, 1)
    const hostOpen = new Uint8Array(tree.count).fill(1)
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b', 'c', 'd'], hostOpen)
    engine.setOpen(tree.idToIndex.get('b')!, false)
    expect(Array.from(hostOpen)).toEqual([1, 1, 1, 1])
  })

  it('does not read a later mutation of the caller-owned sizes array', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const tree = normalize(DATA)
    engine.setViewport(800, 600, 1)
    const hostSizes = sizesFor(tree.count)
    engine.setData(toWireTree(tree), hostSizes, ['a', 'b', 'c', 'd'], new Uint8Array(tree.count).fill(1))
    engine.setCamera({ x: 0, y: 0, k: 1 })
    // Mutate the caller's buffer after handing it over, then force a relayout
    // through an unrelated call (not another setData) to prove the engine
    // never reaches back into the host's array.
    hostSizes[0] = 999
    engine.setOptions({ spacingX: 20 })
    engine.render()
    const prunedA = Array.from(engine.visibleToSource).indexOf(tree.idToIndex.get('a')!)
    expect(prunedA).toBeGreaterThanOrEqual(0)
    expect(engine.boxes[prunedA * 4 + 2]).toBe(100)
  })

  it('does not write through into the caller-owned camera object', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    const cam = { x: 0, y: 0, k: 1 }
    engine.setCamera(cam)
    engine.render()
    expect(renderer.frames.at(-1)!.tier).toBe('full')
    // Mutate the host's camera object directly, without calling setCamera again.
    cam.k = 0.01
    engine.render()
    expect(renderer.frames.at(-1)!.tier).toBe('full')
  })
})

// F3: highlight/drag hold SOURCE indices, meaningless against a new dataset.
describe('ChartEngine resets highlight and drag on setData (F3)', () => {
  it('clears highlight and drag when a new dataset is loaded', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setHighlight(Uint32Array.from([tree.idToIndex.get('c')!]))
    engine.setDrag(tree.idToIndex.get('c')!)
    engine.render()
    expect(renderer.frames.at(-1)!.highlight).not.toBeNull()
    expect(renderer.frames.at(-1)!.dragIndex).not.toBe(-1)

    const NEW_DATA = [{ id: 'x' }, { id: 'y', parentId: 'x' }, { id: 'z', parentId: 'x' }]
    const newTree = normalize(NEW_DATA)
    engine.setData(
      toWireTree(newTree),
      sizesFor(newTree.count),
      ['x', 'y', 'z'],
      new Uint8Array(newTree.count).fill(1),
    )
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const frame = renderer.frames.at(-1)!
    expect(frame.highlight).toBeNull()
    expect(frame.dragIndex).toBe(-1)
  })
})

// F4: `Bounds` has no readonly fields, so returning the module singleton
// before the first relayout lets one engine's (or a caller's) mutation
// corrupt every other engine created before or after it.
describe('ChartEngine bounds isolation (F4)', () => {
  it('does not share the initial bounds object between engines', () => {
    const a = createChartEngine(fakeRenderer())
    const b = createChartEngine(fakeRenderer())
    expect(a.bounds).not.toBe(b.bounds)
    a.bounds.maxX = 12_345
    expect(b.bounds.maxX).toBe(0)
  })
})

// Defect 1: connectors must not vanish just because one endpoint (or, at
// extreme zoom, both) is off screen. `render()` culls to the viewport before
// the renderer ever sees a node, so these three cases have to be checked at
// the culling boundary, not by inspecting pixels.
describe('ChartEngine connector culling (defect 1)', () => {
  it('already draws correctly when the PARENT is off screen and the child is visible (verifies, does not fix)', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const data = [{ id: 'a' }, { id: 'b', parentId: 'a' }]
    const tree = normalize(data)
    engine.setViewport(400, 400, 1)
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b'], new Uint8Array(tree.count).fill(1))
    // 'a' sits at world y in [0, 50]; 'b' at world y in [98, 148] (height 50 +
    // spacingY 48, from tidy.ts's y[i] formula). camera.y = -90 puts 'a'
    // entirely above screen y 0, while 'b' lands at screen y [8, 58].
    engine.setCamera({ x: 0, y: -90, k: 1 })
    engine.render()

    const frame = renderer.frames.at(-1)!
    const aIndex = tree.idToIndex.get('a')!
    const bIndex = tree.idToIndex.get('b')!
    const aPruned = Array.from(engine.visibleToSource).indexOf(aIndex)
    const bPruned = Array.from(engine.visibleToSource).indexOf(bIndex)

    // 'b' is genuinely visible...
    expect(Array.from(frame.visible.slice(0, frame.visibleCount))).toContain(bPruned)
    // ...and its parent pointer resolves to 'a' regardless of whether 'a'
    // itself made it into any culled set — canvas2d.ts reads `parent[i]`
    // directly out of the full array, never gated on the parent's own
    // presence in `visible`. That's the whole reason this case needs no fix.
    expect(frame.parent[bPruned]).toBe(aPruned)
  })

  it('includes an off-screen CHILD in the edge set so its connector to a visible parent still draws', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const data = [{ id: 'a' }, { id: 'b', parentId: 'a' }]
    const tree = normalize(data)
    // 'a' sits at world y [0, 50]; 'b' at world y [98, 148] (height 50 +
    // spacingY 48). The connector's own bounding box (this test's whole
    // point) is the rectangle spanned by 'a's exit point (its bottom-centre,
    // y=50) and 'b's entry point (its top-centre, y=98) — i.e. y in
    // [50, 98]. A viewport of height 60 (world y [0, 60]) makes 'a' fully
    // visible while 'b' stays entirely below it, AND genuinely overlaps that
    // connector box (50 < 60): unlike a shorter viewport that stops short of
    // y=50, this one actually clips the connector's near end, so drawing it
    // is a real requirement, not just a defensive over-inclusion.
    engine.setViewport(1000, 60, 1)
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b'], new Uint8Array(tree.count).fill(1))
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()

    const frame = renderer.frames.at(-1)!
    const bIndex = tree.idToIndex.get('b')!
    const bPruned = Array.from(engine.visibleToSource).indexOf(bIndex)
    expect(bPruned).toBeGreaterThanOrEqual(0)

    // 'b' must not be drawn as a node (it is not genuinely on screen)...
    expect(Array.from(frame.visible.slice(0, frame.visibleCount))).not.toContain(bPruned)
    // ...but it must still be present in the edge set, or its connector to
    // the visible 'a' never gets a chance to render at all.
    expect(Array.from(frame.edges.slice(0, frame.edgeCount))).toContain(bPruned)
  })

  it('includes a child whose connector crosses the viewport even though BOTH endpoints are off screen', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const data = [{ id: 'a' }, { id: 'b', parentId: 'a' }]
    const tree = normalize(data)
    // 'a' bottoms out at world y 50; 'b' starts at world y 98 — a 48-unit gap
    // (exactly spacingY). A 20-unit-tall viewport at world y [60, 80] sits
    // entirely inside that gap: neither box overlaps it, yet the connector's
    // horizontal crossbar (at the midpoint between 50 and 98) passes right
    // through screen space. This is only reachable at extreme zoom / a tiny
    // gap-sized viewport, which is exactly the scenario the bug report describes.
    engine.setViewport(1000, 20, 1)
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b'], new Uint8Array(tree.count).fill(1))
    engine.setCamera({ x: 0, y: -60, k: 1 })
    engine.render()

    const frame = renderer.frames.at(-1)!
    const bIndex = tree.idToIndex.get('b')!
    const bPruned = Array.from(engine.visibleToSource).indexOf(bIndex)
    expect(bPruned).toBeGreaterThanOrEqual(0)

    // Neither node is genuinely visible...
    expect(frame.visibleCount).toBe(0)
    // ...but 'b' is still in the edge set, so its connector — which is what
    // actually crosses the viewport here — still gets drawn.
    expect(Array.from(frame.edges.slice(0, frame.edgeCount))).toContain(bPruned)
  })

  it('does not widen the edge set for a node whose connector is nowhere near the viewport', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    // Push the whole chart far off screen, same as the existing "culls to
    // the viewport instead of drawing everything" test — but here asserting
    // on edgeCount too, since that's the number a margin bug would inflate.
    engine.setCamera({ x: -100_000, y: -100_000, k: 1 })
    engine.render()
    const frame = renderer.frames.at(-1)!
    expect(frame.visibleCount).toBe(0)
    expect(frame.edgeCount).toBe(0)
  })
})

// Defect 2: the growth-axis-only `cullMargin` widening leaves a hole on the
// CROSS axis. A direct parent/child pair can be separated on the cross axis
// by an entire sibling subtree's width — unbounded, unlike the growth-axis
// gap (which is bounded by one level of node-extent + spacing). Constructing
// this requires a genuinely asymmetric tree: a root with one narrow leaf
// child and one very wide leaf child. `tidy.ts`'s `prelim[parent]` formula
// centres the parent over the MIDPOINT of its first and last child, so a
// huge width imbalance between the two children pushes the parent's centre
// far from the narrow child while leaving it close to the wide one — exactly
// reproducing "parent centred at x = -3000, child at x = +3000" from a real
// layout, not a hand-picked coordinate.
describe('ChartEngine connector culling — cross-axis gap (defect 2)', () => {
  function buildAsymmetricTree(orientation: 'tb' | 'lr'): {
    tree: ReturnType<typeof normalize>
    sizes: Float64Array
  } {
    const data = [{ id: 'a' }, { id: 'thin', parentId: 'a' }, { id: 'wide', parentId: 'a' }]
    const tree = normalize(data)
    const sizes = new Float64Array(tree.count * 2)
    const set = (id: string, w: number, h: number) => {
      const idx = tree.idToIndex.get(id)!
      sizes[idx * 2] = w
      sizes[idx * 2 + 1] = h
    }
    // tb: cross axis is x (canonical width) — vary w.
    // lr: cross axis is y (canonical width, pre-transpose, is the real h) — vary h.
    if (orientation === 'tb') {
      set('a', 100, 50)
      set('thin', 100, 50)
      set('wide', 6000, 50)
    } else {
      set('a', 50, 100)
      set('thin', 50, 100)
      set('wide', 50, 6000)
    }
    return { tree, sizes }
  }

  /**
   * Lays out the asymmetric tree, then positions a tiny viewport squarely in
   * the cross-axis gap between 'a' and 'thin' — overlapping neither node's
   * box, but inside the rectangle the elbow between them actually occupies —
   * and renders. Returns the resulting frame and 'thin's pruned index so each
   * `it` block only has to state its own assertion.
   */
  function renderInTheGap(orientation: 'tb' | 'lr') {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const { tree, sizes } = buildAsymmetricTree(orientation)
    engine.setOptions({ orientation })
    engine.setViewport(1, 1, 1) // any positive size — just enough to force a relayout
    engine.setData(toWireTree(tree), sizes, ['a', 'thin', 'wide'], new Uint8Array(tree.count).fill(1))
    engine.render()

    const aPruned = Array.from(engine.visibleToSource).indexOf(tree.idToIndex.get('a')!)
    const thinPruned = Array.from(engine.visibleToSource).indexOf(tree.idToIndex.get('thin')!)
    expect(aPruned).toBeGreaterThanOrEqual(0)
    expect(thinPruned).toBeGreaterThanOrEqual(0)

    const boxOf = (p: number) => ({
      x: engine.boxes[p * 4]!,
      y: engine.boxes[p * 4 + 1]!,
      w: engine.boxes[p * 4 + 2]!,
      h: engine.boxes[p * 4 + 3]!,
    })
    const aBox = boxOf(aPruned)
    const thinBox = boxOf(thinPruned)

    let rect: { minX: number; maxX: number; minY: number; maxY: number }
    if (orientation === 'tb') {
      // Cross axis: x. Growth axis: y (elbow crossbar sits between a's bottom
      // and thin's top).
      expect(Math.abs(aBox.x - thinBox.x)).toBeGreaterThan(1000)
      const thinRight = thinBox.x + thinBox.w
      const lo = Math.min(thinRight, aBox.x)
      const hi = Math.max(thinRight, aBox.x)
      expect(hi - lo).toBeGreaterThan(10) // real room to plant a viewport in
      const gapMin = lo + (hi - lo) / 2 - 5
      const bandLo = Math.min(aBox.y + aBox.h, thinBox.y)
      const bandHi = Math.max(aBox.y + aBox.h, thinBox.y)
      expect(bandHi - bandLo).toBeGreaterThan(4)
      rect = { minX: gapMin, maxX: gapMin + 10, minY: bandLo + 1, maxY: bandHi - 1 }
    } else {
      // Cross axis: y. Growth axis: x.
      expect(Math.abs(aBox.y - thinBox.y)).toBeGreaterThan(1000)
      const thinBottom = thinBox.y + thinBox.h
      const lo = Math.min(thinBottom, aBox.y)
      const hi = Math.max(thinBottom, aBox.y)
      expect(hi - lo).toBeGreaterThan(10)
      const gapMin = lo + (hi - lo) / 2 - 5
      const bandLo = Math.min(aBox.x + aBox.w, thinBox.x)
      const bandHi = Math.max(aBox.x + aBox.w, thinBox.x)
      expect(bandHi - bandLo).toBeGreaterThan(4)
      rect = { minX: bandLo + 1, maxX: bandHi - 1, minY: gapMin, maxY: gapMin + 10 }
    }

    engine.setViewport(rect.maxX - rect.minX, rect.maxY - rect.minY, 1)
    engine.setCamera({ x: -rect.minX, y: -rect.minY, k: 1 })
    engine.render()

    const frame = renderer.frames.at(-1)!
    // Neither endpoint is genuinely on screen: this is the "both off screen"
    // case, not the already-fixed one-endpoint case.
    expect(frame.visibleCount).toBe(0)
    return { frame, thinPruned }
  }

  it('draws the connector when it crosses the viewport but both endpoints are off screen (tb)', () => {
    const { frame, thinPruned } = renderInTheGap('tb')
    expect(Array.from(frame.edges.slice(0, frame.edgeCount))).toContain(thinPruned)
  })

  it('draws the connector when it crosses the viewport but both endpoints are off screen (lr)', () => {
    const { frame, thinPruned } = renderInTheGap('lr')
    expect(Array.from(frame.edges.slice(0, frame.edgeCount))).toContain(thinPruned)
  })
})

// The 50k budget: connector culling must cost what's near the viewport, not
// what's in the whole tree. A margin-widened node query already satisfied
// this for the growth axis; the edge-index fix must not regress it.
describe('ChartEngine 50k budget — drawn edge count stays bounded (defect 2 follow-up)', () => {
  /** Branching-factor-8 tree of exactly `count` nodes (root included). Mirrors
   * engine.bench.test.ts's `buildTree`. */
  function buildBranchingTree(count: number): NodeData[] {
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

  function edgeCountFor(count: number): number {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const tree = normalize(buildBranchingTree(count))
    const sizes = new Float64Array(tree.count * 2)
    for (let i = 0; i < tree.count; i++) {
      sizes[i * 2] = 160
      sizes[i * 2 + 1] = 48
    }
    const labels: string[] = Array.from({ length: tree.count }, () => '')
    engine.setViewport(1600, 900, 1)
    engine.setData(toWireTree(tree), sizes, labels, new Uint8Array(tree.count).fill(1))
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    return renderer.frames.at(-1)!.edgeCount
  }

  it('keeps the drawn edge count bounded as total node count grows from 5,000 to 50,000', () => {
    const small = edgeCountFor(5_000)
    const large = edgeCountFor(50_000)
    // A 1600x900 viewport at k=1 can never have anywhere near this many
    // connectors genuinely crossing it, regardless of how many more nodes
    // exist off screen — that's the whole point of the index.
    expect(small).toBeLessThan(2_000)
    expect(large).toBeLessThan(2_000)
  })
})

// Expand/collapse layout transition. `DATA` is a -> b -> c, a -> d, so
// toggling 'b' closed hides exactly one node ('c') and toggling it back open
// reveals exactly one. `render(now)` is always called with an explicit `now`
// here so progress is fully deterministic — no reliance on wall-clock time.
describe('ChartEngine expand/collapse transition', () => {
  it('does not start a transition when animation is disabled (default)', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render(1000)
    engine.setOpen(tree.idToIndex.get('b')!, false)
    engine.render(1000)
    expect(engine.transitioning).toBe(false)
    expect(renderer.frames.at(-1)!.ghostCount).toBe(0)
  })

  it('progress 0 reproduces the pre-toggle layout exactly for every surviving node', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.setViewport(800, 600, 1)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setOpen(tree.idToIndex.get('b')!, false) // start closed: 'c' hidden
    engine.render(1000)

    const beforeBySource = new Map<number, [number, number, number, number]>()
    for (let i = 0; i < engine.visibleToSource.length; i++) {
      const src = engine.visibleToSource[i]!
      beforeBySource.set(src, [
        engine.boxes[i * 4]!,
        engine.boxes[i * 4 + 1]!,
        engine.boxes[i * 4 + 2]!,
        engine.boxes[i * 4 + 3]!,
      ])
    }

    engine.setOpen(tree.idToIndex.get('b')!, true) // reveal 'c'
    engine.render(1000) // same instant: progress must be exactly 0
    expect(engine.transitioning).toBe(true)
    const frame = renderer.frames.at(-1)!

    let checked = 0
    for (let i = 0; i < engine.visibleToSource.length; i++) {
      const src = engine.visibleToSource[i]!
      const before = beforeBySource.get(src)
      if (before === undefined) continue // 'c': newly revealed, nothing to compare
      expect(frame.boxes[i * 4]).toBeCloseTo(before[0], 10)
      expect(frame.boxes[i * 4 + 1]).toBeCloseTo(before[1], 10)
      expect(frame.boxes[i * 4 + 2]).toBeCloseTo(before[2], 10)
      expect(frame.boxes[i * 4 + 3]).toBeCloseTo(before[3], 10)
      checked++
    }
    expect(checked).toBe(3) // a, b, d — everything except the newly-revealed 'c'
  })

  it('progress 1 reproduces the new layout exactly (same array, not just equal values)', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.setViewport(800, 600, 1)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render(1000)
    engine.setOpen(tree.idToIndex.get('b')!, false)
    engine.render(1000)
    expect(engine.transitioning).toBe(true)

    engine.render(1250) // exactly the 250ms duration: progress 1
    expect(engine.transitioning).toBe(false)
    const frame = renderer.frames.at(-1)!
    expect(Array.from(frame.boxes)).toEqual(Array.from(engine.boxes))
    expect(frame.ghostCount).toBe(0)
  })

  it('keeps a removed node drawn as a fading ghost during the transition, and drops it once done', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.setViewport(800, 600, 1)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render(1000) // all open

    engine.setOpen(tree.idToIndex.get('b')!, false) // removes 'c'
    engine.render(1000) // t=0
    const mid = renderer.frames.at(-1)!
    expect(mid.ghostCount).toBe(1)
    expect(mid.ghostAlpha[0]).toBeCloseTo(1, 5) // just started fading: still ~opaque
    // 'c' truly is gone from the authoritative pruned set, even though it's
    // still being drawn as a ghost.
    expect(Array.from(engine.visibleToSource)).not.toContain(tree.idToIndex.get('c')!)

    engine.render(1250) // past the duration
    const done = renderer.frames.at(-1)!
    expect(done.ghostCount).toBe(0)
  })

  it('a second toggle mid-transition retargets from the current position instead of snapping', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.setViewport(800, 600, 1)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render(1000)

    const bIndex = tree.idToIndex.get('b')!
    engine.setOpen(bIndex, false) // transition 1 starts at t=1000
    engine.render(1000)

    engine.render(1125) // halfway through transition 1 (progress 0.5)
    const halfway = renderer.frames.at(-1)!
    const bPrunedHalfway = Array.from(engine.visibleToSource).indexOf(bIndex)
    expect(bPrunedHalfway).toBeGreaterThanOrEqual(0)
    const midX = halfway.boxes[bPrunedHalfway * 4]!
    const midY = halfway.boxes[bPrunedHalfway * 4 + 1]!

    // Interrupt with a second toggle at the SAME instant.
    engine.setOpen(bIndex, true)
    engine.render(1125)
    const retargeted = renderer.frames.at(-1)!
    const bPrunedNow = Array.from(engine.visibleToSource).indexOf(bIndex)
    expect(bPrunedNow).toBeGreaterThanOrEqual(0)
    // Must continue from wherever it visually was a moment ago, not jump to
    // either endpoint of the transition it just interrupted.
    expect(retargeted.boxes[bPrunedNow * 4]).toBeCloseTo(midX, 6)
    expect(retargeted.boxes[bPrunedNow * 4 + 1]).toBeCloseTo(midY, 6)
  })

  it('hit-tests against the final layout throughout a transition, never the interpolated one', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.setViewport(800, 600, 1)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render(1000)

    engine.setOpen(tree.idToIndex.get('b')!, false)
    engine.render(1000)
    expect(engine.transitioning).toBe(true)

    const dIndex = tree.idToIndex.get('d')!
    const dPruned = Array.from(engine.visibleToSource).indexOf(dIndex)
    const cx = engine.boxes[dPruned * 4]! + engine.boxes[dPruned * 4 + 2]! / 2
    const cy = engine.boxes[dPruned * 4 + 1]! + engine.boxes[dPruned * 4 + 3]! / 2
    expect(engine.hitTest(cx, cy)).toBe(dIndex)
  })

  it('disabling animation mid-transition snaps immediately to the final layout', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.setViewport(800, 600, 1)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render(1000)
    engine.setOpen(tree.idToIndex.get('b')!, false)
    engine.render(1000)
    expect(engine.transitioning).toBe(true)

    engine.setAnimate(false)
    expect(engine.transitioning).toBe(false)
    engine.render(1010)
    const frame = renderer.frames.at(-1)!
    expect(frame.ghostCount).toBe(0)
    expect(Array.from(frame.boxes)).toEqual(Array.from(engine.boxes))
  })

  it('drops an in-flight transition immediately when the dataset is replaced', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.setViewport(800, 600, 1)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render(1000)
    engine.setOpen(tree.idToIndex.get('b')!, false)
    engine.render(1000)
    expect(engine.transitioning).toBe(true)

    const newTree = normalize([{ id: 'x' }, { id: 'y', parentId: 'x' }])
    engine.setData(toWireTree(newTree), sizesFor(newTree.count), ['x', 'y'], new Uint8Array(newTree.count).fill(1))
    expect(engine.transitioning).toBe(false)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render(1010)
    expect(renderer.frames.at(-1)!.ghostCount).toBe(0)
  })

  it('fades in a newly revealed node and clears the reveal-alpha override once settled', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.setViewport(800, 600, 1)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setOpen(tree.idToIndex.get('b')!, false) // start closed
    engine.render(1000)

    engine.setOpen(tree.idToIndex.get('b')!, true) // reveal 'c'
    engine.render(1000) // t=0
    const cIndex = tree.idToIndex.get('c')!
    const frame0 = renderer.frames.at(-1)!
    const cPruned = Array.from(engine.visibleToSource).indexOf(cIndex)
    const slot = Array.from(frame0.visible.slice(0, frame0.visibleCount)).indexOf(cPruned)
    expect(slot).toBeGreaterThanOrEqual(0)
    expect(frame0.revealAlpha).not.toBeNull()
    expect(frame0.revealAlpha![slot]).toBeCloseTo(0, 5)

    engine.render(1250) // done
    expect(renderer.frames.at(-1)!.revealAlpha).toBeNull()
  })
})

// F6: setData accepts an `open` array of any length; the copy taken for F2
// must be sized to `tree.count`, not to whatever length the caller passed.
describe('ChartEngine open-length reconciliation (F6)', () => {
  it('zero-extends a short open array, degrading predictably instead of blanking the chart', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    // a -> b -> c: closing b's default-missing flag hides c but keeps b itself.
    const data = [{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }]
    const tree = normalize(data)
    engine.setViewport(800, 600, 1)
    // Only 'a' is given explicitly; 'b' and 'c' zero-extend to closed.
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b', 'c'], Uint8Array.from([1]))
    engine.setCamera({ x: 0, y: 0, k: 1 })
    const drawn = engine.render()
    // 'b' stays visible (its own visibility isn't gated by its own flag); 'c'
    // is hidden because its parent 'b' defaulted to closed.
    expect(drawn.length).toBe(2)
  })

  it('ignores the tail of an open array longer than the tree', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const data = [{ id: 'a' }, { id: 'b', parentId: 'a' }]
    const tree = normalize(data)
    engine.setViewport(800, 600, 1)
    const longOpen = Uint8Array.from([1, 1, 1, 1, 1])
    expect(() =>
      engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b'], longOpen),
    ).not.toThrow()
    engine.setCamera({ x: 0, y: 0, k: 1 })
    const drawn = engine.render()
    expect(drawn.length).toBe(2)
  })
})
