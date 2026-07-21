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
    },
    moveTo(x, y) {
      currentPath?.push({ x, y })
    },
    lineTo(x, y) {
      currentPath?.push({ x, y })
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
      if (currentPath !== null && currentPath.length > 0) {
        for (let i = 0; i < currentPath.length; i += 4) {
          edgeSegments.push(currentPath.slice(i, i + 4))
        }
      }
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

/** Parses the single batched edge `<path>`'s `d` into one 4-point group per edge. */
function parseEdgeSegments(svg: string): Point[][] {
  const dMatch = /<path class="e" d="([^"]*)"\/>/.exec(svg)
  if (dMatch === null) return []
  const d = dMatch[1]!
  const pointRe = /(-?[\d.]+),(-?[\d.]+)/g
  const points: Point[] = []
  for (const m of d.matchAll(pointRe)) points.push({ x: Number(m[1]), y: Number(m[2]) })
  const segments: Point[][] = []
  for (let i = 0; i < points.length; i += 4) segments.push(points.slice(i, i + 4))
  return segments
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
