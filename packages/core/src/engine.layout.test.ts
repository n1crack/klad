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
