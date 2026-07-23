import { describe, expect, it } from 'vitest'
import { createCanvas2DRenderer } from './canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import { DEFAULT_THEME } from './theme.js'
import type { Frame } from './renderer.js'

function makeCanvas(width = 400, height = 300): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  document.body.appendChild(canvas)
  return canvas
}

function measurerFor(font: string) {
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = font
  return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
}

/**
 * Two boxes, child below parent.
 *
 * `edges`/`edgeCount` default to whatever `visible`/`visibleCount` resolve to
 * (explicit override or the `2` default) rather than fixed values: most of
 * these tests only ever touch `visibleCount`, and if `edgeCount` stayed
 * pinned at `2` while a test set `visibleCount: 0`, the edge-stroking loop
 * would walk two "edge" slots that no longer correspond to anything the
 * caller set up.
 */
function frame(overrides: Partial<Frame> = {}): Frame {
  const visibleCount = overrides.visibleCount ?? 2
  const edgeCount = overrides.edgeCount ?? visibleCount
  return {
    boxes: Float64Array.from([0, 0, 100, 50, 0, 100, 100, 50]),
    parent: Int32Array.from([-1, 0]),
    visible: Uint32Array.from([0, 1]),
    visibleCount,
    edges: Uint32Array.from([0, 1]),
    edgeCount,
    labels: ['Root', 'Child'],
    camera: { x: 10, y: 10, k: 1 },
    dpr: 1,
    tier: 'full',
    horizontal: false,
    highlight: null,
    dragIndex: -1,
    revealAlpha: null,
    ghostBoxes: new Float64Array(0),
    ghostAlpha: new Float32Array(0),
    ghostCount: 0,
    ringActive: false,
    ringBox: new Float64Array(4),
    ringProgress: 0,
    ...overrides,
  }
}

function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): Uint8ClampedArray {
  return canvas.getContext('2d')!.getImageData(x, y, 1, 1).data
}

describe('createCanvas2DRenderer', () => {
  it('draws a node where the camera puts it', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame())

    // Node 0 spans screen x 10..110, y 10..60. Its centre must not be blank.
    const inside = pixelAt(canvas, 60, 35)
    expect(inside[3]).toBeGreaterThan(0)
    // Far corner is untouched.
    const outside = pixelAt(canvas, 380, 290)
    expect(outside[3]).toBe(0)
  })

  it('scales the backing store by dpr but keeps camera units in CSS pixels', () => {
    const canvas = makeCanvas(800, 600)
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 2)
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(600)

    renderer.draw(frame())
    // The same world point lands at twice the device pixel offset.
    expect(pixelAt(canvas, 120, 70)[3]).toBeGreaterThan(0)
  })

  it('batches every edge into one path regardless of node count', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)

    const count = 50
    const boxes = new Float64Array(count * 4)
    const parent = new Int32Array(count)
    const visible = new Uint32Array(count)
    for (let i = 0; i < count; i++) {
      boxes[i * 4] = (i % 10) * 30
      boxes[i * 4 + 1] = Math.floor(i / 10) * 60
      boxes[i * 4 + 2] = 20
      boxes[i * 4 + 3] = 20
      parent[i] = i === 0 ? -1 : i - 1
      visible[i] = i
    }
    renderer.draw(
      frame({ boxes, parent, visible, visibleCount: count, edges: visible, edgeCount: count, labels: [] }),
    )
    expect(renderer.stats.lastDrawCalls.edgeStrokes).toBe(1)
  })

  it('skips text entirely at the block tier', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame({ tier: 'block' }))
    expect(renderer.stats.lastDrawCalls.labels).toBe(0)
  })

  it('draws one label per visible node at the label tier', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame({ tier: 'label' }))
    expect(renderer.stats.lastDrawCalls.labels).toBe(2)
  })

  it('clears the previous frame', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame())
    expect(pixelAt(canvas, 60, 35)[3]).toBeGreaterThan(0)

    renderer.draw(frame({ visibleCount: 0, visible: new Uint32Array(0) }))
    expect(pixelAt(canvas, 60, 35)[3]).toBe(0)
  })

  it('draws nothing and does not throw on an empty frame', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    expect(() =>
      renderer.draw(
        frame({
          boxes: new Float64Array(0),
          parent: new Int32Array(0),
          visible: new Uint32Array(0),
          visibleCount: 0,
          labels: [],
        }),
      ),
    ).not.toThrow()
  })

  // `theme.blockFill` — the `block` tier's own, independently adjustable
  // fill, defaulting to `'transparent'` (see theme.ts's docblock) so the
  // far-zoom shape-only tier shows the tree's connector skeleton rather than
  // a wall of solid `nodeFill` boxes by default.
  describe('block-tier fill (theme.blockFill)', () => {
    it('draws nothing for a node at the block tier under the DEFAULT theme (blockFill: transparent)', () => {
      const canvas = makeCanvas()
      const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
      renderer.resize(400, 300, 1)
      renderer.draw(frame({ tier: 'block' }))
      // Node 0 spans screen x 10..110, y 10..60 (see the `frame()` docblock
      // above) — its centre must be untouched: no fill, no stroke (the
      // latter already skipped at `block` regardless of `blockFill`).
      expect(pixelAt(canvas, 60, 35)[3]).toBe(0)
    })

    it('fills a node at the block tier once blockFill is set to an opaque colour', () => {
      const canvas = makeCanvas()
      const renderer = createCanvas2DRenderer(
        canvas,
        { ...DEFAULT_THEME, blockFill: '#ff00ff' },
        measurerFor,
      )
      renderer.resize(400, 300, 1)
      renderer.draw(frame({ tier: 'block' }))
      const pixel = pixelAt(canvas, 60, 35)
      expect(pixel[3]).toBeGreaterThan(0) // opaque: something was painted
      expect(pixel[0]).toBeGreaterThan(200) // red channel of #ff00ff
      expect(pixel[1]).toBeLessThan(50) // green channel
      expect(pixel[2]).toBeGreaterThan(200) // blue channel
    })

    it('never fills a REMOVED (ghost) node at the block tier when blockFill is transparent', () => {
      const canvas = makeCanvas()
      const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
      renderer.resize(400, 300, 1)
      renderer.draw(
        frame({
          tier: 'block',
          visibleCount: 0,
          visible: new Uint32Array(0),
          edgeCount: 0,
          ghostBoxes: Float64Array.from([0, 0, 100, 50]),
          ghostAlpha: Float32Array.from([1]),
          ghostCount: 1,
        }),
      )
      expect(pixelAt(canvas, 60, 35)[3]).toBe(0)
    })

    it('still uses nodeFill (not blockFill) at the label tier', () => {
      const canvas = makeCanvas()
      const renderer = createCanvas2DRenderer(
        canvas,
        { ...DEFAULT_THEME, nodeFill: '#00ff00', blockFill: '#ff00ff' },
        measurerFor,
      )
      renderer.resize(400, 300, 1)
      renderer.draw(frame({ tier: 'label' }))
      const pixel = pixelAt(canvas, 60, 35)
      expect(pixel[0]).toBeLessThan(50) // red channel of #00ff00, not #ff00ff
      expect(pixel[1]).toBeGreaterThan(200) // green channel of #00ff00
    })

    it('still uses nodeFill (not blockFill) at the full tier', () => {
      const canvas = makeCanvas()
      const renderer = createCanvas2DRenderer(
        canvas,
        { ...DEFAULT_THEME, nodeFill: '#00ff00', blockFill: '#ff00ff' },
        measurerFor,
      )
      renderer.resize(400, 300, 1)
      renderer.draw(frame({ tier: 'full' }))
      const pixel = pixelAt(canvas, 60, 35)
      expect(pixel[0]).toBeLessThan(50)
      expect(pixel[1]).toBeGreaterThan(200)
    })

    it('still shows a highlighted node at the block tier even when blockFill is transparent', () => {
      const canvas = makeCanvas()
      const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
      renderer.resize(400, 300, 1)
      renderer.draw(frame({ tier: 'block', highlight: Uint8Array.from([1, 0]) }))
      // Node 0 is highlighted — it must still paint `highlightFill`, the
      // deliberate exception `theme.blockFill`'s "skip the fill" rule
      // carves out (see canvas2d.ts's node-drawing loop).
      expect(pixelAt(canvas, 60, 35)[3]).toBeGreaterThan(0)
      // Node 1 (unhighlighted; screen x 10..110, y 110..160) stays untouched,
      // same as the plain case above.
      expect(pixelAt(canvas, 60, 135)[3]).toBe(0)
    })
  })

  it('tints a highlighted node differently from an unhighlighted one', () => {
    const plain = makeCanvas()
    const plainRenderer = createCanvas2DRenderer(plain, DEFAULT_THEME, measurerFor)
    plainRenderer.resize(400, 300, 1)
    plainRenderer.draw(frame())

    const lit = makeCanvas()
    const litRenderer = createCanvas2DRenderer(lit, DEFAULT_THEME, measurerFor)
    litRenderer.resize(400, 300, 1)
    litRenderer.draw(frame({ highlight: Uint8Array.from([1, 0]) }))

    expect(Array.from(pixelAt(lit, 60, 35))).not.toEqual(Array.from(pixelAt(plain, 60, 35)))
  })
})

describe('highlighted path edges', () => {
  // Parent 0 at y 0..50, child 1 at y 100..150, both 100 wide at x 0. With
  // camera {10,10,1} the connector runs down the shared centre line at screen
  // x = 60, between screen y 60 and y 110 — so y 85 is on the elbow's vertical
  // leg, clear of either box.
  const ON_THE_EDGE = { x: 60, y: 85 }

  it('draws an edge in the ordinary colour when nothing is highlighted', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame())

    const [r, , b, a] = pixelAt(canvas, ON_THE_EDGE.x, ON_THE_EDGE.y)
    expect(a).toBeGreaterThan(0)
    // DEFAULT_THEME.edgeStroke is #d4d4d8 — a neutral grey, i.e. r ~= g ~= b.
    expect(Math.abs(r! - b!)).toBeLessThan(12)
  })

  // An edge is "on the path" when BOTH its endpoints are highlighted, which
  // for a root-to-node chain is exactly the edges along it. Without this the
  // nodes light up but the route between them does not, so what the eye gets
  // is a scatter of lit boxes rather than a way through the tree.
  it('draws an edge in the highlight colour when both its endpoints are lit', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame({ highlight: Uint8Array.from([1, 1]) }))

    const [r, g, b] = pixelAt(canvas, ON_THE_EDGE.x, ON_THE_EDGE.y)
    // DEFAULT_THEME.edgeHighlightStroke is #f59e0b: strongly warm, so red
    // dominates blue by a wide margin — the one thing that cannot be true of
    // the neutral grey it replaces.
    expect(r!).toBeGreaterThan(b! + 80)
    expect(g!).toBeGreaterThan(b!)
  })

  it('leaves an edge ordinary when only one endpoint is lit', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    // Only the child. A highlight that lights a node without lighting its
    // parent says nothing about the connector between them — a search result
    // deep in the tree must not imply a route it was never asked to draw.
    renderer.draw(frame({ highlight: Uint8Array.from([0, 1]) }))

    const [r, , b] = pixelAt(canvas, ON_THE_EDGE.x, ON_THE_EDGE.y)
    expect(Math.abs(r! - b!)).toBeLessThan(12)
  })

  it('reports the second stroke pass only when a path is actually lit', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)

    renderer.draw(frame())
    expect(renderer.stats.lastDrawCalls.edgeStrokes).toBe(1)

    // A highlight with no lit EDGE in it must not pay for a second pass.
    renderer.draw(frame({ highlight: Uint8Array.from([0, 1]) }))
    expect(renderer.stats.lastDrawCalls.edgeStrokes).toBe(1)

    renderer.draw(frame({ highlight: Uint8Array.from([1, 1]) }))
    expect(renderer.stats.lastDrawCalls.edgeStrokes).toBe(2)
  })
})
