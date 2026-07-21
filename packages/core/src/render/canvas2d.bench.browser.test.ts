import { describe, expect, it } from 'vitest'
import { createCanvas2DRenderer } from './canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import { DEFAULT_THEME } from './theme.js'
import type { Frame } from './renderer.js'

// Real `performance` exists in this environment (a real browser, via
// playwright) — no `declare const` shim needed here the way the DOM-free
// bench files need one.

function makeCanvas(width: number, height: number): HTMLCanvasElement {
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

/** Grid layout: `count` boxes of 160x60, 8 per row, 40px gaps. Every non-root
 * links to node 0, so the edge-batching path (one stroke, `count - 1`
 * segments) is exercised too. */
function gridFrame(count: number, tier: Frame['tier']): Frame {
  const boxes = new Float64Array(count * 4)
  const parent = new Int32Array(count)
  const visible = new Uint32Array(count)
  const labels: string[] = Array.from({ length: count })
  const cols = 40
  for (let i = 0; i < count; i++) {
    boxes[i * 4] = (i % cols) * 200
    boxes[i * 4 + 1] = Math.floor(i / cols) * 100
    boxes[i * 4 + 2] = 160
    boxes[i * 4 + 3] = 60
    parent[i] = i === 0 ? -1 : 0
    visible[i] = i
    labels[i] = `Node ${i} — a moderately long label to truncate`
  }
  return {
    boxes,
    parent,
    visible,
    visibleCount: count,
    edgeCount: count,
    labels,
    camera: { x: 0, y: 0, k: 1 },
    dpr: 1,
    tier,
    horizontal: false,
    highlight: null,
    dragIndex: -1,
    revealAlpha: null,
    ghostBoxes: new Float64Array(0),
    ghostAlpha: new Float32Array(0),
    ghostCount: 0,
  }
}

/** Repeatedly re-panning the same visible set: camera.x/y changes every
 * frame (as a real pan would), everything else held fixed. */
function benchDraw(count: number, tier: Frame['tier'], frames: number): number {
  const canvas = makeCanvas(1600, 900)
  const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
  renderer.resize(1600, 900, 1)
  const frame = gridFrame(count, tier)

  // Warm up.
  for (let i = 0; i < 10; i++) {
    frame.camera = { x: -i, y: -i, k: 1 }
    renderer.draw(frame)
  }

  const start = performance.now()
  for (let i = 0; i < frames; i++) {
    frame.camera = { x: -i * 3, y: -i, k: 1 }
    renderer.draw(frame)
  }
  const elapsed = performance.now() - start
  canvas.remove()
  return elapsed / frames
}

describe('canvas2d draw performance (bench, informational)', () => {
  it('reports per-frame draw() cost at realistic visible-set sizes, full tier', () => {
    for (const count of [200, 800, 2000, 4000]) {
      const avg = benchDraw(count, 'full', 60)
      // eslint-disable-next-line no-console
      console.log(`[bench] canvas2d.draw() avg, ${count} visible, full tier: ${avg.toFixed(4)}ms/frame`)
    }
    expect(true).toBe(true)
  })

  it('reports per-frame draw() cost at realistic visible-set sizes, block tier (no text/stroke)', () => {
    for (const count of [200, 800, 2000, 4000]) {
      const avg = benchDraw(count, 'block', 60)
      console.log(`[bench] canvas2d.draw() avg, ${count} visible, block tier: ${avg.toFixed(4)}ms/frame`)
    }
    expect(true).toBe(true)
  })
})
