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
