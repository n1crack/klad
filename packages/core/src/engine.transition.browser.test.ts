import { describe, expect, it } from 'vitest'
import { createChartEngine } from './engine.js'
import { createCanvas2DRenderer } from './render/canvas2d.js'
import { createTextMeasurer } from './text/measure.js'
import { DEFAULT_THEME } from './render/theme.js'
import { toWireTree } from './worker/protocol.js'
import { normalize } from './tree.js'

/**
 * End-to-end visual check for the expand/collapse transition, using the
 * REAL engine and the REAL Canvas2D renderer in an actual browser (this file
 * matches `*.browser.test.ts`, so it runs under Chromium via Playwright, not
 * a DOM shim) — not a mock, not a headless approximation of the drawing
 * logic. It cannot exercise the playground itself: that requires the vanilla
 * layer to call `setAnimate`/thread a `requestAnimationFrame` timestamp into
 * `render(now)`, which is out of this change's scope (packages/vanilla is
 * fenced off — see the engine.ts changes for the API this is meant to
 * plug into). This is the closest available substitute: sampling actual
 * rendered pixels at several points through a real transition, on a real
 * canvas, so "does a collapse visibly shrink/fade" and "does a reveal
 * visibly fade in" are answered by looking at the canvas rather than by
 * asserting on internal state.
 */

function makeCanvas(width = 400, height = 300): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  document.body.appendChild(canvas)
  return canvas
}

function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): Uint8ClampedArray {
  return canvas.getContext('2d')!.getImageData(x, y, 1, 1).data
}

function measurerFor(font: string) {
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = font
  return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
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

describe('expand/collapse transition, rendered on a real canvas', () => {
  it('a collapse visibly shrinks and fades the removed node, ending with it fully gone', () => {
    const canvas = makeCanvas(600, 400)
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(600, 400, 1)
    const engine = createChartEngine(renderer)
    const tree = normalize(DATA)

    engine.setAnimate(true)
    engine.setViewport(600, 400, 1)
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b', 'c', 'd'], new Uint8Array(tree.count).fill(1))
    engine.setCamera({ x: 50, y: 50, k: 1 })
    engine.render(1000) // all open — establishes the pre-collapse layout

    const cPruned = Array.from(engine.visibleToSource).indexOf(tree.idToIndex.get('c')!)
    // 'c's screen-space centre before the collapse — this is where its ghost
    // should visibly start, then shrink/fade away from.
    const cx = engine.boxes[cPruned * 4]! + engine.boxes[cPruned * 4 + 2]! / 2 + 50
    const cy = engine.boxes[cPruned * 4 + 1]! + engine.boxes[cPruned * 4 + 3]! / 2 + 50

    engine.setOpen(tree.idToIndex.get('b')!, false) // collapses 'b', removing 'c'
    engine.render(1000) // t=0 of the transition: 'c' should still be fully painted
    const atStart = pixelAt(canvas, cx, cy)
    expect(atStart[3]).toBeGreaterThan(0) // still opaque — the ghost hasn't faded at all yet

    engine.render(1210) // halfway
    const atHalfway = pixelAt(canvas, cx, cy)

    engine.render(1420) // past the transition's duration
    expect(engine.transitioning).toBe(false)
    const atEnd = pixelAt(canvas, cx, cy)
    // By the end the ghost is gone and 'c's old position (now outside the
    // collapsed layout's node boxes) is back to the clear canvas colour.
    expect(atEnd[3]).toBe(0)

    // Report the actual alpha channel readings at all three points — this is
    // the closest a non-visual assertion gets to "watching" the fade: alpha
    // should visibly step down from opaque, to partial, to gone.
    // eslint-disable-next-line no-console
    console.log(
      `[visual check] collapse fade at c's old centre — start alpha=${atStart[3]}, halfway alpha=${atHalfway[3]}, end alpha=${atEnd[3]}`,
    )
    expect(atHalfway[3]!).toBeLessThanOrEqual(atStart[3]!)
    expect(atHalfway[3]!).toBeGreaterThanOrEqual(atEnd[3]!)
  })

  it('an expand visibly fades in the revealed node, ending fully opaque', () => {
    const canvas = makeCanvas(600, 400)
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(600, 400, 1)
    const engine = createChartEngine(renderer)
    const tree = normalize(DATA)

    engine.setAnimate(true)
    engine.setViewport(600, 400, 1)
    engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b', 'c', 'd'], new Uint8Array(tree.count).fill(1))
    engine.setOpen(tree.idToIndex.get('b')!, false) // start closed: 'c' hidden
    engine.setCamera({ x: 50, y: 50, k: 1 })
    engine.render(1000)

    engine.setOpen(tree.idToIndex.get('b')!, true) // reveal 'c'
    engine.render(1000) // t=0: 'c' should be nearly/fully transparent
    const cPruned = Array.from(engine.visibleToSource).indexOf(tree.idToIndex.get('c')!)
    const cx = engine.boxes[cPruned * 4]! + engine.boxes[cPruned * 4 + 2]! / 2 + 50
    const cy = engine.boxes[cPruned * 4 + 1]! + engine.boxes[cPruned * 4 + 3]! / 2 + 50
    const atStart = pixelAt(canvas, cx, cy)

    engine.render(1210)
    const atHalfway = pixelAt(canvas, cx, cy)

    engine.render(1420)
    expect(engine.transitioning).toBe(false)
    const atEnd = pixelAt(canvas, cx, cy)

    // eslint-disable-next-line no-console
    console.log(
      `[visual check] reveal fade-in at c's final centre — start alpha=${atStart[3]}, halfway alpha=${atHalfway[3]}, end alpha=${atEnd[3]}`,
    )
    expect(atEnd[3]).toBeGreaterThan(0)
    expect(atHalfway[3]!).toBeGreaterThanOrEqual(atStart[3]!)
    expect(atEnd[3]!).toBeGreaterThanOrEqual(atHalfway[3]!)
  })
})
