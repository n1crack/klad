import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { layout } from '../layout/tidy.js'
import { applyOrientation, type Orientation } from '../layout/orientation.js'
import { createCanvas2DRenderer } from './canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import { DEFAULT_THEME } from './theme.js'
import { escapeXml, toSVG, type ExportData } from './svg.js'
import type { Frame, RenderContext2D, RenderSurface } from './renderer.js'
import type { NodeData } from '../types.js'

// ---------------------------------------------------------------------------
// A fake RenderContext2D/RenderSurface that RECORDS what canvas2d.ts would
// actually have drawn, instead of a real canvas. `RenderContext2D` is a
// structural interface (see renderer.ts's docblock: this package has no
// `lib.dom`), so nothing here needs a DOM — this test runs in the plain
// `node` vitest project alongside every other core test, not the `browser`
// one canvas2d.browser.test.ts needs for real pixel assertions.
//
// The point of this file is the cross-check itself: comparing GEOMETRY
// (numbers) that both the canvas backend and svg.ts derive from the exact
// same boxes/parent/labels input is far more tractable — and far more
// precise — than a pixel diff between a canvas snapshot and a rasterized
// SVG would be.
// ---------------------------------------------------------------------------

interface RecordedRect {
  x: number
  y: number
  w: number
  h: number
  radius: number
}

interface Point {
  x: number
  y: number
}

interface RecordedText {
  text: string
  x: number
  y: number
}

function makeRecorder(): {
  ctx: RenderContext2D
  surface: RenderSurface
  rects: RecordedRect[]
  edgeSegments: Point[][]
  texts: RecordedText[]
} {
  const rects: RecordedRect[] = []
  const edgeSegments: Point[][] = []
  const texts: RecordedText[] = []
  let currentPath: Point[] | null = null
  // Subpaths already closed off by a later `moveTo` within the SAME
  // beginPath()/stroke() pair, waiting to be committed to `edgeSegments`
  // once `stroke()` fires. Grouping by `moveTo` (rather than the fixed
  // "4 points per edge" chunking this used before rounded elbows existed)
  // is what lets this recorder cope with edges of DIFFERENT point counts in
  // the same batch — a straight elbow is 4 points (`moveTo` + 3 `lineTo`), a
  // rounded one is 8 (`moveTo`, `lineTo`, `quadraticCurveTo` x2 worth of
  // points, `lineTo`, `quadraticCurveTo` x2 worth of points, `lineTo`), and a
  // radius clamped to 0 for one short edge but not its neighbours means a
  // single batch can contain both shapes at once.
  let pendingSegments: Point[][] = []

  const ctx: RenderContext2D = {
    fillStyle: undefined,
    strokeStyle: undefined,
    lineWidth: 0,
    font: '',
    globalAlpha: 1,
    textBaseline: '',
    save() {},
    restore() {},
    scale() {},
    translate() {},
    setTransform() {},
    clearRect() {},
    beginPath() {
      currentPath = []
      pendingSegments = []
    },
    moveTo(x, y) {
      if (currentPath !== null && currentPath.length > 0) pendingSegments.push(currentPath)
      currentPath = [{ x, y }]
    },
    lineTo(x, y) {
      currentPath?.push({ x, y })
    },
    quadraticCurveTo(cpx, cpy, x, y) {
      // Recorded as two points (control, then end) — the same shape
      // `parseEdgeSegments` extracts from an SVG `Q` command's two
      // coordinate pairs, so a rounded elbow's point count matches on both
      // sides of the cross-check.
      currentPath?.push({ x: cpx, y: cpy }, { x, y })
    },
    roundRect(x, y, w, h, radii) {
      rects.push({ x, y, w, h, radius: radii })
    },
    rect(x, y, w, h) {
      rects.push({ x, y, w, h, radius: 0 })
    },
    fill() {
      // Node fill only; edges are stroked, never filled.
    },
    stroke() {
      // Only the edge-batch path ever accumulates >0 points before a
      // stroke() call — a node's own beginPath()/roundRect()/fill()/stroke()
      // sequence never pushes into currentPath (roundRect isn't moveTo/
      // lineTo), so this can't misfile a node's stroke as an edge.
      if (currentPath !== null && currentPath.length > 0) pendingSegments.push(currentPath)
      if (pendingSegments.length > 0) edgeSegments.push(...pendingSegments)
      pendingSegments = []
      currentPath = null
    },
    fillText(text, x, y) {
      texts.push({ text, x, y })
    },
    measureText(text) {
      return { width: text.length * 7 }
    },
  }

  const surface: RenderSurface = {
    width: 100_000,
    height: 100_000,
    getContext: () => ctx,
  }

  return { ctx, surface, rects, edgeSegments, texts }
}

interface Built {
  n: number
  boxes: Float64Array
  parent: Int32Array
  labels: string[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  horizontal: boolean
}

/** A small, non-trivial tree: 3 levels, uneven branching, varied box sizes —
 * enough to exercise real elbow geometry (not just a single parent/child
 * pair) without hand-computing dozens of coordinates. */
function buildFixture(orientation: Orientation): Built {
  const data: NodeData[] = [
    { id: 'root' },
    { id: 'a', parentId: 'root' },
    { id: 'b', parentId: 'root' },
    { id: 'c', parentId: 'root' },
    { id: 'a1', parentId: 'a' },
    { id: 'a2', parentId: 'a' },
    { id: 'b1', parentId: 'b' },
  ]
  const tree = normalize(data)
  const n = tree.count
  const sizes = new Float64Array(n * 2)
  const horizontal = orientation === 'lr' || orientation === 'rl'
  const rawW = [120, 90, 140, 80, 60, 100, 130]
  const rawH = [50, 40, 55, 45, 30, 48, 52]
  for (let i = 0; i < n; i++) {
    const w = rawW[i]!
    const h = rawH[i]!
    // Same transpose-before-layout convention engine.ts uses for lr/rl.
    sizes[i * 2] = horizontal ? h : w
    sizes[i * 2 + 1] = horizontal ? w : h
  }
  const result = layout(tree, sizes, { spacingX: 16, spacingY: 48 })
  const bounds = applyOrientation(result.boxes, result.bounds, orientation, false)
  const labels = tree.indexToId.map((id) => `Node ${id}`)
  return { n, boxes: result.boxes, parent: tree.parent, labels, bounds, horizontal }
}

function measurerFor() {
  return createTextMeasurer({ measureWidth: (t) => t.length * 7 })
}

function frameFrom(built: Built): Frame {
  const visible = Uint32Array.from({ length: built.n }, (_, i) => i)
  const edges: number[] = []
  for (let i = 0; i < built.n; i++) if (built.parent[i] !== -1) edges.push(i)
  return {
    boxes: built.boxes,
    parent: built.parent,
    visible,
    visibleCount: built.n,
    edges: Uint32Array.from(edges),
    edgeCount: edges.length,
    labels: built.labels,
    camera: { x: 0, y: 0, k: 1 },
    dpr: 1,
    tier: 'full',
    horizontal: built.horizontal,
    highlight: null,
    selected: null,
    dragIndex: -1,
    revealAlpha: null,
    ghostBoxes: new Float64Array(0),
    ghostAlpha: new Float32Array(0),
    ghostCount: 0,
    ringActive: false,
    ringBox: new Float64Array(4),
    ringProgress: 0,
  }
}

function exportDataFrom(built: Built): ExportData {
  return {
    boxes: built.boxes,
    parent: built.parent,
    labels: built.labels,
    bounds: built.bounds,
    horizontal: built.horizontal,
  }
}

/** Parses `<rect class="n" .../>` elements in document order. */
function parseRects(svg: string): RecordedRect[] {
  const re = /<rect class="n" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"(?: rx="([^"]+)")?\/>/g
  const out: RecordedRect[] = []
  for (const m of svg.matchAll(re)) {
    out.push({
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[3]),
      h: Number(m[4]),
      radius: m[5] !== undefined ? Number(m[5]) : 0,
    })
  }
  return out
}

/**
 * Parses the single batched edge `<path>`'s `d` into one point-group per
 * edge, split on each `M` (moveto) command rather than a fixed point count —
 * a straight elbow is `M L L L` (4 points), a rounded one is
 * `M L Q L Q L` (8 points, since each `Q`'s control+end pair both match the
 * coordinate regex below), and a batch can mix both shapes when one edge's
 * radius clamps to 0 and a neighbour's doesn't. Mirrors `makeRecorder`'s
 * `moveTo`-driven grouping on the canvas side exactly, for the same reason.
 */
function parseEdgeSegments(svg: string): Point[][] {
  const dMatch = /<path class="e" d="([^"]*)"\/>/.exec(svg)
  if (dMatch === null) return []
  const d = dMatch[1]!
  if (d.length === 0) return []
  const pointRe = /(-?[\d.]+),(-?[\d.]+)/g
  return d
    .split(/(?=M)/)
    .filter((sub) => sub.length > 0)
    .map((sub) => {
      const points: Point[] = []
      for (const m of sub.matchAll(pointRe)) points.push({ x: Number(m[1]), y: Number(m[2]) })
      return points
    })
}

function parseTexts(svg: string): RecordedText[] {
  const re = /<text class="l" x="([^"]+)" y="([^"]+)">([^<]*)<\/text>/g
  const out: RecordedText[] = []
  for (const m of svg.matchAll(re)) out.push({ x: Number(m[1]), y: Number(m[2]), text: m[3]! })
  return out
}

describe.each<Orientation>(['tb', 'bt', 'lr', 'rl'])('toSVG matches canvas2d geometry (%s)', (orientation) => {
  it('draws identical node rects, connector elbows, and label anchors', () => {
    const built = buildFixture(orientation)
    const { ctx, surface, rects, edgeSegments, texts } = makeRecorder()
    const renderer = createCanvas2DRenderer(surface, DEFAULT_THEME, measurerFor)
    renderer.draw(frameFrom(built))
    void ctx

    // padding: 0 so svg.ts's offsetX/offsetY collapse to -bounds.minX/-minY,
    // which is 0 here (layout()/applyOrientation() guarantee minX===minY===0)
    // — i.e. identical world-space coordinates to what the canvas frame used
    // (camera { x: 0, y: 0, k: 1 }), so no translation needs to be undone
    // before comparing numbers.
    const svg = toSVG(exportDataFrom(built), { padding: 0 })

    const svgRects = parseRects(svg)
    expect(svgRects).toHaveLength(rects.length)
    for (let i = 0; i < rects.length; i++) {
      expect(svgRects[i]!.x).toBeCloseTo(rects[i]!.x, 1)
      expect(svgRects[i]!.y).toBeCloseTo(rects[i]!.y, 1)
      expect(svgRects[i]!.w).toBeCloseTo(rects[i]!.w, 1)
      expect(svgRects[i]!.h).toBeCloseTo(rects[i]!.h, 1)
      expect(svgRects[i]!.radius).toBeCloseTo(rects[i]!.radius, 1)
    }

    const svgEdges = parseEdgeSegments(svg)
    expect(svgEdges).toHaveLength(edgeSegments.length)
    expect(svgEdges.length).toBeGreaterThan(0)
    for (let e = 0; e < edgeSegments.length; e++) {
      const expected = edgeSegments[e]!
      const actual = svgEdges[e]!
      expect(actual).toHaveLength(expected.length)
      for (let p = 0; p < expected.length; p++) {
        expect(actual[p]!.x).toBeCloseTo(expected[p]!.x, 1)
        expect(actual[p]!.y).toBeCloseTo(expected[p]!.y, 1)
      }
    }

    // Anchor POSITION must match the canvas exactly — same box, same
    // labelPadding, same vertical-centre formula. Text CONTENT deliberately
    // is not compared against the canvas recording here: this fixture's
    // smaller boxes (e.g. 60x30 for 'a1') are exactly the case where
    // canvas2d.ts's zoom-dependent measurer.truncate() shortens the label
    // to fit, while toSVG's whole point is to never do that (see toSVG's
    // docblock) — so svg text content is asserted against the FULL source
    // label instead, and is expected to legitimately differ from the
    // canvas's (possibly truncated) text whenever a box is snug.
    const svgTexts = parseTexts(svg)
    expect(svgTexts).toHaveLength(texts.length)
    for (let i = 0; i < texts.length; i++) {
      expect(svgTexts[i]!.x).toBeCloseTo(texts[i]!.x, 1)
      expect(svgTexts[i]!.y).toBeCloseTo(texts[i]!.y, 1)
      expect(svgTexts[i]!.text).toBe(built.labels[i])
    }
  })
})

describe.each<Orientation>(['tb', 'bt', 'lr', 'rl'])(
  'rounded connector elbows (edgeCornerRadius > 0) match between canvas and svg (%s)',
  (orientation) => {
    it('draws without throwing and matches the svg export point-for-point', () => {
      const built = buildFixture(orientation)
      const theme = { ...DEFAULT_THEME, edgeCornerRadius: 6 }
      const { ctx, surface, edgeSegments } = makeRecorder()
      const renderer = createCanvas2DRenderer(surface, theme, measurerFor)
      expect(() => renderer.draw(frameFrom(built))).not.toThrow()
      void ctx

      const svg = toSVG(exportDataFrom(built), { padding: 0, theme })
      // A rounded elbow is a curve, not a straight-cornered polyline.
      expect(svg).toContain('Q')

      const svgEdges = parseEdgeSegments(svg)
      expect(svgEdges.length).toBeGreaterThan(0)
      expect(svgEdges).toHaveLength(edgeSegments.length)
      // Every edge's point count must match between the two renderers
      // exactly, whatever that count turns out to be for a given edge — a
      // rounded corner is 8 points (moveTo, tangent-in, [corner,
      // tangent-out] x2, tangent-in, [corner, tangent-out], final point);
      // a corner the per-edge clamp reduced to 0 (e.g. a lone child this
      // fixture's tidy-tree layout happens to centre directly under its
      // parent, collapsing that edge's crossbar to zero width) falls back
      // to the ordinary 4-point straight elbow instead — both are valid,
      // and the two renderers must agree on which one applies to EACH edge.
      let anyRounded = false
      for (let e = 0; e < edgeSegments.length; e++) {
        const expected = edgeSegments[e]!
        const actual = svgEdges[e]!
        expect(actual).toHaveLength(expected.length)
        expect([4, 8]).toContain(actual.length)
        if (actual.length === 8) anyRounded = true
        for (let p = 0; p < expected.length; p++) {
          expect(actual[p]!.x).toBeCloseTo(expected[p]!.x, 1)
          expect(actual[p]!.y).toBeCloseTo(expected[p]!.y, 1)
        }
      }
      // At least one edge in this fixture must actually have rounded —
      // otherwise this test would pass even if the radius were silently
      // ignored everywhere.
      expect(anyRounded).toBe(true)
    })
  },
)

describe('edge corner radius scales with zoom like the node corner radius', () => {
  it('doubles the on-screen bend distance when the camera zoom doubles', () => {
    const built = buildFixture('tb')
    const theme = { ...DEFAULT_THEME, edgeCornerRadius: 4 }
    const frame1x = frameFrom(built)
    const frame2x = { ...frame1x, camera: { x: 0, y: 0, k: 2 } }

    const rec1 = makeRecorder()
    createCanvas2DRenderer(rec1.surface, theme, measurerFor).draw(frame1x)
    const rec2 = makeRecorder()
    createCanvas2DRenderer(rec2.surface, theme, measurerFor).draw(frame2x)

    // Compare the first edge's tangent-in point (index 1) against its
    // moveTo point (index 0): the screen-space distance between them IS the
    // effective on-screen radius (world radius * k), so it must double
    // alongside the camera's k, exactly like `theme.cornerRadius` already
    // does for node corners (see canvas2d.ts's `radius = theme.cornerRadius * k`).
    const dist = (seg: Point[]): number => Math.hypot(seg[1]!.x - seg[0]!.x, seg[1]!.y - seg[0]!.y)
    const d1 = dist(rec1.edgeSegments[0]!)
    const d2 = dist(rec2.edgeSegments[0]!)
    expect(d2).toBeCloseTo(d1 * 2, 5)
  })
})

describe('edge corner radius clamps against a short connector', () => {
  /** parent centred at x=50 (box x=0..100, so `px` = 50); child centred at
   * x=60 (box x=10..110, so `cx` = 60) — a 10-unit crossbar, deliberately
   * shorter than twice the requested radius (100), so the clamp must
   * reduce the effective radius rather than let the two corners' arcs
   * overshoot into and past each other. */
  const data: ExportData = {
    boxes: Float64Array.from([0, 0, 100, 50, 10, 200, 100, 50]),
    parent: Int32Array.from([-1, 0]),
    labels: ['Root', 'Child'],
    bounds: { minX: 0, minY: 0, maxX: 110, maxY: 250 },
    horizontal: false,
  }

  it('does not throw and clamps the two arcs to meet, not cross, at the crossbar midpoint', () => {
    const theme = { ...DEFAULT_THEME, edgeCornerRadius: 100 }
    let svg = ''
    expect(() => {
      svg = toSVG(data, { padding: 0, theme })
    }).not.toThrow()

    // px=50, py=50, cx=60, cy=200, midY=125. seg0 = seg2 = 75, segMid = 10.
    // Clamp: r = min(75, 75, 10/2) = 5 — the shared crossbar, not the
    // (comfortably longer) outer legs, is what limits it here.
    // tangent_out (corner 1, along the crossbar) = (55, 125).
    // tangent_in (corner 2, along the crossbar) = (55, 125) — the SAME
    // point: the two arcs meet exactly at the crossbar's midpoint rather
    // than overshooting past each other, which is what the clamp exists to
    // guarantee for a connector this short.
    const svgEdges = parseEdgeSegments(svg)
    expect(svgEdges).toHaveLength(1)
    const points = svgEdges[0]!
    expect(points).toHaveLength(8)
    // index 0: M(50,50); 1: tangent-in corner1 (50,120); 2: corner1 control
    // (50,125); 3: tangent-out corner1 (55,125); 4: tangent-in corner2
    // (55,125); 5: corner2 control (60,125); 6: tangent-out corner2
    // (60,130); 7: L(60,200).
    expect(points[3]!.x).toBeCloseTo(55, 1)
    expect(points[3]!.y).toBeCloseTo(125, 1)
    expect(points[4]!.x).toBeCloseTo(55, 1)
    expect(points[4]!.y).toBeCloseTo(125, 1)
    // The two touching points must not have crossed (actual[3].x <= actual[4].x
    // given px < cx here) — equality is the exact boundary this clamp targets.
    expect(points[3]!.x).toBeLessThanOrEqual(points[4]!.x + 1e-6)
  })

  it('falls back to a fully straight elbow (no Q at all) when the crossbar collapses to zero length', () => {
    // Same parent, but the child re-centred directly above/below it
    // (cx === px) — a zero-length crossbar. `segMid / 2` clamps the radius
    // to 0 regardless of how large the theme asks for, same as a `rect`
    // falling back from `roundRect` at radius 0.
    const zeroCrossbar: ExportData = {
      boxes: Float64Array.from([0, 0, 100, 50, 0, 200, 100, 50]),
      parent: Int32Array.from([-1, 0]),
      labels: ['Root', 'Child'],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 250 },
      horizontal: false,
    }
    const theme = { ...DEFAULT_THEME, edgeCornerRadius: 100 }
    const svg = toSVG(zeroCrossbar, { padding: 0, theme })
    const pathMatch = /<path class="e" d="([^"]*)"\/>/.exec(svg)
    expect(pathMatch).not.toBeNull()
    expect(pathMatch![1]).not.toContain('Q')
    expect(pathMatch![1]).toContain('L')
  })

  it('draws the same short connector on canvas without throwing', () => {
    const theme = { ...DEFAULT_THEME, edgeCornerRadius: 100 }
    const { surface } = makeRecorder()
    const renderer = createCanvas2DRenderer(surface, theme, measurerFor)
    const frame: Frame = {
      boxes: data.boxes,
      parent: data.parent,
      visible: Uint32Array.from([0, 1]),
      visibleCount: 2,
      edges: Uint32Array.from([1]),
      edgeCount: 1,
      labels: data.labels,
      camera: { x: 0, y: 0, k: 1 },
      dpr: 1,
      tier: 'full',
      horizontal: false,
      highlight: null,
    selected: null,
      dragIndex: -1,
      revealAlpha: null,
      ghostBoxes: new Float64Array(0),
      ghostAlpha: new Float32Array(0),
      ghostCount: 0,
      ringActive: false,
      ringBox: new Float64Array(4),
      ringProgress: 0,
    }
    expect(() => renderer.draw(frame)).not.toThrow()
  })
})

describe('straight elbows (edgeCornerRadius: 0, the default) never emit a curve command', () => {
  it('contains only M/L commands in the edge path', () => {
    const built = buildFixture('tb')
    const svg = toSVG(exportDataFrom(built), { padding: 0 })
    const pathMatch = /<path class="e" d="([^"]*)"\/>/.exec(svg)
    expect(pathMatch).not.toBeNull()
    expect(pathMatch![1]).not.toContain('Q')
  })
})

describe('toSVG text handling', () => {
  it('never truncates a label, even when far wider than its box', () => {
    const longLabel = 'A'.repeat(500)
    const data: ExportData = {
      boxes: Float64Array.from([0, 0, 20, 20]),
      parent: Int32Array.from([-1]),
      labels: [longLabel],
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
      horizontal: false,
    }
    const svg = toSVG(data)
    expect(svg).toContain(longLabel)
  })

  it('skips nodes with an empty or missing label without emitting an empty <text>', () => {
    const data: ExportData = {
      boxes: Float64Array.from([0, 0, 20, 20, 30, 0, 20, 20]),
      parent: Int32Array.from([-1, -1]),
      labels: ['', 'Second'],
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 20 },
      horizontal: false,
    }
    const svg = toSVG(data)
    expect(svg.match(/<text/g) ?? []).toHaveLength(1)
    expect(svg).toContain('Second')
  })
})

describe('toSVG escaping (hostile labels)', () => {
  function singleNodeSvg(label: string): string {
    const data: ExportData = {
      boxes: Float64Array.from([0, 0, 100, 40]),
      parent: Int32Array.from([-1]),
      labels: [label],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
      horizontal: false,
    }
    return toSVG(data)
  }

  it('escapes ampersand, angle brackets, and quotes so a hostile label cannot break out of <text>', () => {
    const label = `Alice & Bob <script>alert('x')</script> "CEO"`
    const svg = singleNodeSvg(label)

    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&amp;')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('&apos;x&apos;')
    expect(svg).toContain('&quot;CEO&quot;')

    // No bare `&` survives outside of a recognised entity anywhere in the
    // document — the general well-formedness property this whole section
    // exists to guarantee.
    const bareAmpersand = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/
    expect(bareAmpersand.test(svg)).toBe(false)

    // And no raw '<' or '>' should appear inside what was the label's own
    // text content — only as the surrounding element delimiters that toSVG
    // itself emits (<svg>, <style>, <path>, <rect>, <text>...</text>).
    const textMatch = /<text class="l"[^>]*>([\s\S]*?)<\/text>/.exec(svg)
    expect(textMatch).not.toBeNull()
    expect(textMatch![1]).not.toContain('<')
    expect(textMatch![1]).not.toContain('>')
  })

  it('strips disallowed control characters and replaces lone surrogates', () => {
    const label = `Bad\x00Name\x01\x1FTail\uD800End`
    const svg = singleNodeSvg(label)
    expect(svg).not.toContain('\x00')
    expect(svg).not.toContain('\x01')
    expect(svg).not.toContain('\x1F')
    expect(svg).not.toContain('\uD800')
    expect(svg).toContain('BadName')
    expect(svg).toContain('Tail�End')
  })

  it('keeps a valid surrogate pair (real Unicode, e.g. an emoji) intact', () => {
    const label = 'Team \u{1F680} Launch'
    const svg = singleNodeSvg(label)
    expect(svg).toContain(label)
  })

  it('preserves tab, newline, and carriage return, which are legal XML text', () => {
    const label = 'Line1\tLine2'
    const svg = singleNodeSvg(label)
    expect(svg).toContain('Line1\tLine2')
  })
})

describe('escapeXml', () => {
  it('escapes each of the five XML-significant characters', () => {
    expect(escapeXml('&')).toBe('&amp;')
    expect(escapeXml('<')).toBe('&lt;')
    expect(escapeXml('>')).toBe('&gt;')
    expect(escapeXml('"')).toBe('&quot;')
    expect(escapeXml("'")).toBe('&apos;')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeXml('Jane Doe, VP Engineering')).toBe('Jane Doe, VP Engineering')
  })
})

describe('toSVG document shape', () => {
  it('produces a single root <svg> with a viewBox sized to bounds + padding', () => {
    const data: ExportData = {
      boxes: Float64Array.from([0, 0, 100, 40]),
      parent: Int32Array.from([-1]),
      labels: ['Root'],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
      horizontal: false,
    }
    const svg = toSVG(data, { padding: 10 })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('viewBox="0 0 120 60"')
  })

  it('omits the edge <path> entirely for a single-node (rootless-edge) tree', () => {
    const data: ExportData = {
      boxes: Float64Array.from([0, 0, 100, 40]),
      parent: Int32Array.from([-1]),
      labels: ['Root'],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
      horizontal: false,
    }
    const svg = toSVG(data)
    expect(svg).not.toContain('<path')
  })

  it('handles an empty tree without throwing', () => {
    const data: ExportData = {
      boxes: new Float64Array(0),
      parent: new Int32Array(0),
      labels: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      horizontal: false,
    }
    expect(() => toSVG(data)).not.toThrow()
  })

  it('does not let a theme value break out of the style element', () => {
    // A theme can legitimately come from user-controlled data — a colour picker,
    // a per-tenant row — so a value closing the <style> element must not reach
    // the output as markup.
    const svg = toSVG(
      {
        boxes: Float64Array.from([0, 0, 100, 50]),
        parent: Int32Array.from([-1]),
        labels: ['Root'],
        bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
        horizontal: false,
      },
      { theme: { ...DEFAULT_THEME, nodeFill: '</style><script>alert(1)</script>' } },
    )
    expect(svg).not.toContain('<script>')
    // The style element must contain no markup at all — a legitimate document
    // naturally has `</style><rect`, so asserting on that would be meaningless.
    const style = /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1] ?? ''
    expect(style).not.toContain('<')
    expect(style).not.toContain('>')
  })
})
