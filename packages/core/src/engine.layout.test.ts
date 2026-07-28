import { describe, expect, it, vi } from 'vitest'
import { createChartEngine } from './engine.js'
import { toWireTree } from './worker/protocol.js'
import { normalize } from './tree.js'
import type { Frame, Renderer } from './render/renderer.js'
import type { NodeData } from './types.js'

/**
 * Engine-level tests for the layout registry, branch colouring and the
 * sunburst's drill-down — the parts that are only correct if the ENGINE wires
 * them up, not just the pure layout functions (which have their own tests
 * under `layout/`).
 */

function fakeRenderer(): Renderer & { frames: Frame[] } {
  const frames: Frame[] = []
  return {
    frames,
    resize: vi.fn(),
    draw: (f: Frame) => {
      frames.push({
        ...f,
        boxes: f.boxes.slice(),
        visible: f.visible.slice(0, f.visibleCount),
        edges: f.edges.slice(0, f.edgeCount),
        sectors: f.sectors === null ? null : f.sectors.slice(),
        angles: f.angles === null ? null : f.angles.slice(),
        branchOf: f.branchOf === null ? null : f.branchOf.slice(),
        branchDepth: f.branchDepth === null ? null : f.branchDepth.slice(),
        camera: { ...f.camera },
      })
    },
    stats: { lastDrawCalls: { edgeStrokes: 0, nodes: 0, labels: 0 } },
    setTheme: vi.fn(),
  }
}

const DATA: NodeData[] = [
  { id: 'root' },
  { id: 'a', parentId: 'root' },
  { id: 'a1', parentId: 'a' },
  { id: 'a2', parentId: 'a' },
  { id: 'b', parentId: 'root' },
  { id: 'b1', parentId: 'b' },
]

function seed(renderer: Renderer) {
  const engine = createChartEngine(renderer)
  const tree = normalize(DATA)
  const sizes = new Float64Array(tree.count * 2).fill(40)
  engine.setViewport(800, 600, 1)
  engine.setData(toWireTree(tree), sizes, tree.indexToId.slice(), new Uint8Array(tree.count).fill(1))
  return { engine, tree }
}

const idx = (tree: ReturnType<typeof normalize>, id: string): number => tree.idToIndex.get(id)!

describe('layout option', () => {
  it('relayouts when the layout changes', () => {
    // Not obvious, and it regressed once: `setOptions` only marks the layout
    // dirty for keys it knows change relayout output, and a new key missing
    // from that list silently does nothing until something else forces a
    // relayout. The symptom is a chart that draws the DEFAULT layout however
    // the caller configured it.
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.render(0)
    const tidy = Array.from(engine.boxes)

    engine.setOptions({ layout: 'file' })
    engine.render(1)
    expect(Array.from(engine.boxes)).not.toEqual(tidy)

    // A file list stacks: every node on its own row, x driven by depth alone.
    const boxes = engine.boxes
    const xs = new Set(Array.from({ length: 6 }, (_, i) => boxes[i * 4]!))
    expect(xs.size).toBe(3) // three depths
  })

  it('relayouts for every layout tuning knob', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setOptions({ layout: 'file' })
    engine.render(0)
    const before = Array.from(engine.boxes)

    engine.setOptions({ layoutStep: 77 })
    engine.render(1)
    expect(Array.from(engine.boxes)).not.toEqual(before)

    const stepped = Array.from(engine.boxes)
    engine.setOptions({ rowGap: 31 })
    engine.render(2)
    expect(Array.from(engine.boxes)).not.toEqual(stepped)
  })

  it('falls back to tidy for an unknown layout instead of throwing', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.render(0)
    const tidy = Array.from(engine.boxes)
    // A bad name has to degrade to a working chart — this may be arriving
    // from a `postMessage` inside a worker, where a throw is unreachable.
    engine.setOptions({ layout: 'nonsense' as 'tidy' })
    engine.render(1)
    expect(Array.from(engine.boxes)).toEqual(tidy)
  })

  it('applies orientation to tidy and to nothing else', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setOptions({ layout: 'file', orientation: 'lr' })
    engine.render(0)
    const lr = Array.from(engine.boxes)

    engine.setOptions({ orientation: 'tb' })
    engine.render(1)
    // A file list under `lr` is still a vertical list of rows: orientation is
    // tidy's alone, and transposing here would hand the layout its rows'
    // widths as heights.
    expect(Array.from(engine.boxes)).toEqual(lr)
    expect(renderer.frames.at(-1)!.horizontal).toBe(false)
  })

  it('reports the connector style each layout asks for', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    const styleAfter = (layout: 'tidy' | 'file' | 'radial' | 'sunburst', now: number) => {
      engine.setOptions({ layout })
      engine.render(now)
      return renderer.frames.at(-1)!
    }
    expect(styleAfter('tidy', 0).edgeStyle).toBe('tiered')
    expect(styleAfter('file', 1).edgeStyle).toBe('folder')
    expect(styleAfter('radial', 2).edgeStyle).toBe('spoke')

    const wheel = styleAfter('sunburst', 3)
    expect(wheel.edgeStyle).toBe('none')
    // And it skips building the index entirely, rather than building one the
    // renderer then ignores.
    expect(wheel.edgeCount).toBe(0)
  })
})

describe('branch colouring', () => {
  it('is on for a sunburst and off for everything else, unless asked', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.render(0)
    expect(renderer.frames.at(-1)!.branchOf).toBeNull()

    engine.setOptions({ layout: 'sunburst' })
    engine.render(1)
    expect(renderer.frames.at(-1)!.branchOf).not.toBeNull()

    engine.setOptions({ layout: 'tidy', colourBranches: true })
    engine.render(2)
    expect(renderer.frames.at(-1)!.branchOf).not.toBeNull()

    engine.setOptions({ layout: 'sunburst', colourBranches: false })
    engine.render(3)
    expect(renderer.frames.at(-1)!.branchOf).toBeNull()
  })

  it('maps each node to its own top-level ancestor', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setOptions({ layout: 'sunburst' })
    engine.render(0)
    const frame = renderer.frames.at(-1)!
    const at = (id: string) => idx(tree, id)

    expect(frame.branchOf![at('root')]).toBe(-1)
    expect(frame.branchOf![at('a')]).toBe(at('a'))
    expect(frame.branchOf![at('a1')]).toBe(at('a'))
    expect(frame.branchOf![at('b1')]).toBe(at('b'))

    expect(frame.branchDepth![at('a')]).toBe(0)
    expect(frame.branchDepth![at('a1')]).toBe(1)
  })

  it('is structure, not colour — a theme swap cannot dirty the layout', () => {
    // `setTheme` is documented as paint-only. Baking the palette into a string
    // per node in the engine would force a relayout on every theme change.
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setOptions({ layout: 'sunburst' })
    engine.render(0)
    const first = renderer.frames.at(-1)!.branchOf
    engine.render(1)
    // Same array object across frames: nothing recomputed it.
    expect(renderer.frames.at(-1)!.branchOf).toEqual(first)
  })
})

describe('sunburst focus', () => {
  function wheel() {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setOptions({ layout: 'sunburst', layoutStep: 10, maxRings: 3 })
    engine.setAnimate(true)
    engine.render(0)
    return { renderer, engine, tree }
  }

  it('re-centres the wheel on the focused node', () => {
    const { engine, tree } = wheel()
    engine.setFocus(idx(tree, 'a'))
    engine.render(1000)
    const sectors = engine.sectors!
    const a = idx(tree, 'a')
    expect(sectors[a * 6 + 2]).toBe(0) // hub: inner radius zero
    expect(sectors[a * 6 + 5]! - sectors[a * 6 + 4]!).toBeCloseTo(Math.PI * 2)
  })

  it('leaves the frame and the centre exactly where they were', () => {
    // The whole point of the interaction: no camera move, no refit, no jump.
    const { engine, tree } = wheel()
    const bounds = { ...engine.bounds }
    const centre = [engine.sectors![0], engine.sectors![1]]

    engine.setFocus(idx(tree, 'a2'))
    engine.render(1000)
    expect(engine.bounds).toEqual(bounds)
    expect([engine.sectors![0], engine.sectors![1]]).toEqual(centre)
  })

  it('animates in polar space rather than snapping', () => {
    const { renderer, engine, tree } = wheel()
    const a = idx(tree, 'a')
    const before = engine.sectors![a * 6 + 5]! - engine.sectors![a * 6 + 4]!

    engine.setFocus(a)
    engine.render(0)
    const settled = engine.sectors![a * 6 + 5]! - engine.sectors![a * 6 + 4]!

    // Mid-flight: the frame's sectors must be somewhere BETWEEN the two
    // layouts. Interpolating the bounding boxes instead (what the ordinary
    // transition does) would not describe an arc at any point along the way.
    engine.render(200)
    const mid = renderer.frames.at(-1)!.sectors!
    const midSpan = mid[a * 6 + 5]! - mid[a * 6 + 4]!
    expect(midSpan).toBeGreaterThan(before)
    expect(midSpan).toBeLessThan(settled)
    expect(engine.transitioning).toBe(true)

    // And it finishes.
    engine.render(2000)
    expect(engine.transitioning).toBe(false)
    const done = renderer.frames.at(-1)!.sectors!
    expect(done[a * 6 + 5]! - done[a * 6 + 4]!).toBeCloseTo(settled)
  })

  it('retargets from where the wheel actually is when a click lands mid-flight', () => {
    const { renderer, engine, tree } = wheel()
    engine.setFocus(idx(tree, 'a'))
    engine.render(0)
    engine.render(200)
    const mid = renderer.frames.at(-1)!.sectors!.slice()

    // A second drill-down before the first finished must continue from the
    // painted frame, not snap back to the layout it left.
    engine.setFocus(idx(tree, 'a2'))
    engine.render(210)
    const after = renderer.frames.at(-1)!.sectors!
    const b1 = idx(tree, 'b1')
    for (const o of [b1 * 6 + 4, b1 * 6 + 5]) {
      expect(Math.abs(after[o]! - mid[o]!)).toBeLessThan(0.2)
    }
  })

  it('snaps when animation is off', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setOptions({ layout: 'sunburst', layoutStep: 10 })
    engine.setAnimate(false)
    engine.render(0)
    engine.setFocus(idx(tree, 'a'))
    engine.render(1)
    expect(engine.transitioning).toBe(false)
    expect(Array.from(renderer.frames.at(-1)!.sectors!)).toEqual(Array.from(engine.sectors!))
  })

  it('ignores a focus that is already set', () => {
    const { engine, tree } = wheel()
    engine.setFocus(idx(tree, 'a'))
    engine.render(1000) // starts the drill-down
    engine.render(3000) // and lets it finish
    expect(engine.transitioning).toBe(false)

    engine.setFocus(idx(tree, 'a'))
    engine.render(3001)
    // A host wiring this to a click handler calls it unconditionally; a
    // no-op call must not restart an animation that already finished.
    expect(engine.transitioning).toBe(false)
  })

  it('falls back to the default centre for a focus that is collapsed away', () => {
    const { engine, tree } = wheel()
    engine.setOpen(idx(tree, 'a'), false, false)
    engine.setFocus(idx(tree, 'a1'))
    engine.render(2000)
    // `a1` is not in the pruned tree at all; centring on it is meaningless,
    // and resolving it to whatever now holds that pruned index would centre
    // the wheel on an unrelated node.
    expect(Array.from(engine.sectors!).every(Number.isFinite)).toBe(true)
    expect(engine.sectors![2]).toBe(0) // the root is back in the hub
  })
})

describe('sunburst hit-testing', () => {
  it('resolves a click by its wedge, not by its bounding box', () => {
    // Sector bounding boxes overlap heavily near the centre — an inner ring's
    // box contains most of the disc — so the quadtree reliably answers with
    // the wrong node there.
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setOptions({ layout: 'sunburst', layoutStep: 30, maxRings: 3 })
    engine.render(0)

    const sectors = engine.sectors!
    for (const id of ['root', 'a', 'b', 'a1', 'b1']) {
      const i = idx(tree, id)
      const o = i * 6
      const r = (sectors[o + 2]! + sectors[o + 3]!) / 2
      const angle = (sectors[o + 4]! + sectors[o + 5]!) / 2
      const hit = engine.hitTest(sectors[o]! + r * Math.cos(angle), sectors[o + 1]! + r * Math.sin(angle))
      expect(hit).toBe(i)
    }
  })

  it('misses outside the wheel', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setOptions({ layout: 'sunburst', layoutStep: 30 })
    engine.render(0)
    expect(engine.hitTest(-500, -500)).toBe(-1)
  })
})

describe('export data', () => {
  it('carries the polar geometry and branch structure, at the final layout', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setOptions({ layout: 'sunburst', layoutStep: 10 })
    engine.setAnimate(true)
    engine.render(0)
    engine.setFocus(idx(tree, 'a'))
    engine.render(100) // mid-drill-down

    const data = engine.getExportData()
    expect(data.edgeStyle).toBe('none')
    expect(data.sectors).not.toBeNull()
    expect(data.branchOf).not.toBeNull()
    // The FINAL layout, never a transition's interpolated state — exporting
    // mid-animation should not produce a still of a wheel caught between two
    // layouts.
    expect(Array.from(data.sectors!)).toEqual(Array.from(engine.sectors!))
  })

  it('carries the radial label reserve so the export can place names', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setOptions({ layout: 'radial', layoutStep: 100 })
    engine.render(0)
    const data = engine.getExportData()
    expect(data.angles).not.toBeNull()
    expect(data.labelSpace).toBeGreaterThan(0)
  })
})

describe('sunburst culling', () => {
  it('reports only the sectors it actually paints', () => {
    // `sunburst` keeps every node and collapses the ones outside the ring
    // window to zero extent, and their bounding boxes are degenerate points
    // at the centre of the disc — which is on screen essentially always. So
    // the quadtree returns all of them. Without a second pass, a tree showing
    // three rings reports every node in it as visible, and the vanilla layer
    // builds its DOM overlay and its screen-reader mirror from that list.
    const renderer = fakeRenderer()
    const deep: NodeData[] = [{ id: 'r' }]
    for (let i = 0; i < 40; i++) deep.push({ id: `n${i}`, parentId: i === 0 ? 'r' : `n${i - 1}` })
    const tree = normalize(deep)
    const engine = createChartEngine(renderer)
    engine.setViewport(800, 600, 1)
    engine.setData(
      toWireTree(tree),
      new Float64Array(tree.count * 2).fill(40),
      tree.indexToId.slice(),
      new Uint8Array(tree.count).fill(1),
    )
    engine.setOptions({ layout: 'sunburst', layoutStep: 10, maxRings: 3 })
    const drawn = engine.render(0)

    // Hub plus three rings of a single-file chain: four nodes, not 41.
    expect(drawn.length).toBe(4)
    expect(renderer.frames.at(-1)!.visibleCount).toBe(4)
  })

  it('keeps a closing sector on screen while it is still closing', () => {
    // The cull tests THIS FRAME's geometry, not the settled layout. A sector
    // heading for zero is still visibly shrinking, and culling it on its
    // final extent would pop it off instead of animating it away.
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setOptions({ layout: 'sunburst', layoutStep: 10, maxRings: 3 })
    engine.setAnimate(true)
    engine.render(0)
    const before = renderer.frames.at(-1)!.visibleCount

    engine.setFocus(idx(tree, 'a'))
    engine.render(0)
    engine.render(60) // barely into the 620ms drill-down
    const mid = renderer.frames.at(-1)!.visibleCount
    engine.render(5000) // settled
    const after = renderer.frames.at(-1)!.visibleCount

    expect(mid).toBeGreaterThan(after)
    expect(mid).toBeLessThanOrEqual(before)
  })
})

describe('hidden-children marks', () => {
  it('flags a node whose children are all off screen, for either reason', () => {
    // Two reasons a wheel hides children, and they are one question to a
    // viewer: the branch is closed, or its children fell past the last ring.
    // Without a mark for both, a collapsed branch looks exactly like a leaf —
    // the chart omits the fact that there is more, which is worse than
    // showing less.
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setOptions({ layout: 'sunburst', layoutStep: 10, maxRings: 1 })
    engine.render(0)

    const marks = renderer.frames.at(-1)!.hasHidden
    expect(marks).not.toBeNull()
    // `a` and `b` are on the last drawn ring, so their own children are parked
    // at zero thickness beyond it.
    expect(marks![idx(tree, 'a')]).toBe(1)
    expect(marks![idx(tree, 'b')]).toBe(1)
    // The hub's children ARE drawn.
    expect(marks![idx(tree, 'root')]).toBe(0)
    // And a genuine leaf is never flagged.
    expect(marks![idx(tree, 'b1')]).toBe(0)
  })

  it('flags a collapsed branch on a rectangular layout too', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setOpen(idx(tree, 'a'), false, false)
    engine.render(0)
    const marks = renderer.frames.at(-1)!.hasHidden
    expect(marks).not.toBeNull()
    // `hasHidden` is PRUNED-indexed, like every other per-node array on a
    // `Frame` — and a collapse is exactly when the two index spaces stop
    // agreeing, since the nodes it removed are gone from the pruned one.
    const at = (id: string): number => {
      const source = idx(tree, id)
      return marks![engine.visibleToSource.indexOf(source)]!
    }
    expect(at('a')).toBe(1)
    expect(at('b')).toBe(0)
  })

  it('flags a node whose children have not been fetched', () => {
    // An unloaded node has NO children in the source tree, so it takes the
    // genuine-leaf early-out and would get no mark at all — leaving it
    // indistinguishable from a leaf, with nothing to say there is more inside
    // and nothing to invite the click that would go and get it.
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    const tree = normalize(DATA)
    const sizes = new Float64Array(tree.count * 2).fill(40)
    const unloaded = new Uint8Array(tree.count)
    // `b1` is a genuine leaf in this dataset; the host says otherwise.
    unloaded[idx(tree, 'b1')] = 1
    engine.setViewport(800, 600, 1)
    engine.setData(
      toWireTree(tree),
      sizes,
      tree.indexToId.slice(),
      new Uint8Array(tree.count).fill(1),
      unloaded,
    )
    engine.render(0)

    const marks = renderer.frames.at(-1)!.hasHidden
    expect(marks).not.toBeNull()
    const at = (id: string): number => marks![engine.visibleToSource.indexOf(idx(tree, id))]!
    expect(at('b1')).toBe(1)
    // Every other leaf is untouched — the mask says nothing about them.
    expect(at('a1')).toBe(0)
    expect(at('a2')).toBe(0)
  })

  it('is null when nothing is hiding anything', () => {
    // The whole steady state of a fully expanded chart — no array allocated,
    // no per-node pass in the renderer.
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.render(0)
    expect(renderer.frames.at(-1)!.hasHidden).toBeNull()
  })
})

describe('animateNextLayout', () => {
  /** `seed`'s tree with `a1` moved under `b` — the array rebuilt the way a
   * reparent rebuilds it, so the source indices genuinely shift. */
  function reparented() {
    return normalize([
      { id: 'root' },
      { id: 'a', parentId: 'root' },
      { id: 'a2', parentId: 'a' },
      { id: 'b', parentId: 'root' },
      { id: 'b1', parentId: 'b' },
      { id: 'a1', parentId: 'b' },
    ] satisfies NodeData[])
  }

  function remapBetween(from: ReturnType<typeof normalize>, to: ReturnType<typeof normalize>) {
    const remap = new Int32Array(from.count).fill(-1)
    for (let i = 0; i < from.count; i++) remap[i] = to.idToIndex.get(from.indexToId[i]!) ?? -1
    return remap
  }

  it('animates a move that would otherwise snap', () => {
    // The engine's default is right for the two cases it already knew about —
    // a toggle animates, new data snaps — but a reparent is a third: the same
    // nodes at different positions. It has to be asked for, because the engine
    // cannot tell a reparent from a fresh dataset by looking at it.
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.render(0)

    const next = reparented()
    engine.animateNextLayout(remapBetween(tree, next))
    engine.setData(
      toWireTree(next),
      new Float64Array(next.count * 2).fill(40),
      next.indexToId.slice(),
      new Uint8Array(next.count).fill(1),
    )
    engine.render(0)
    expect(engine.transitioning).toBe(true)
    engine.render(2000)
    expect(engine.transitioning).toBe(false)
  })

  it('snaps without it, so loading new data still snaps', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setAnimate(true)
    engine.render(0)

    const next = reparented()
    engine.setData(
      toWireTree(next),
      new Float64Array(next.count * 2).fill(40),
      next.indexToId.slice(),
      new Uint8Array(next.count).fill(1),
    )
    engine.render(0)
    expect(engine.transitioning).toBe(false)
  })

  it('tweens each node from its OWN previous box, not from its old index', () => {
    // The bug this exists to prevent: a source index only means anything
    // within one `normalize`, and a reparent rebuilds the array. Without the
    // remap every node tweens from wherever its index used to point, which
    // reads as the whole chart shuffling rather than one node moving.
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.render(0)

    const boxBefore = new Map<string, number>()
    for (let i = 0; i < engine.visibleToSource.length; i++) {
      boxBefore.set(tree.indexToId[engine.visibleToSource[i]!]!, engine.boxes[i * 4]!)
    }

    const next = reparented()
    engine.animateNextLayout(remapBetween(tree, next))
    engine.setData(
      toWireTree(next),
      new Float64Array(next.count * 2).fill(40),
      next.indexToId.slice(),
      new Uint8Array(next.count).fill(1),
    )
    engine.render(0)

    // At t=0 every surviving node is drawn exactly where it was, by NAME.
    const frame = renderer.frames.at(-1)!
    for (let n = 0; n < frame.visibleCount; n++) {
      const i = frame.visible[n]!
      const id = next.indexToId[engine.visibleToSource[i]!]!
      const was = boxBefore.get(id)
      if (was === undefined) continue
      expect(frame.boxes[i * 4]!).toBeCloseTo(was, 5)
    }
  })

  it('does nothing if the setData it describes never comes', () => {
    // The remap maps indices from ONE tree to ONE other tree. A flag left
    // standing until some unrelated relayout would animate the wrong change
    // with a mapping that no longer describes anything — so it is tied to
    // `setData`, and arming without one is a no-op.
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setAnimate(true)
    engine.render(0)

    engine.animateNextLayout(remapBetween(tree, tree))
    engine.setOptions({ spacingX: 99 })
    engine.render(1)
    expect(engine.transitioning).toBe(false)
  })
})
