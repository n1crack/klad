import { describe, expect, it } from 'vitest'
import { labelPlacement, lineHeightOf, normaliseUpright, sectorPath, SECTOR_LABEL_PAD } from './sector.js'
import type { RenderContext2D } from './renderer.js'

const TAU = Math.PI * 2

/** Records the path commands `sectorPath` issues, so the traced shape can be
 * asserted without a canvas. */
function recorder(): RenderContext2D & { calls: string[] } {
  const calls: string[] = []
  const noop = (): void => {}
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    globalAlpha: 1,
    textBaseline: '',
    textAlign: '',
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    rotate: noop,
    setTransform: noop,
    clearRect: noop,
    beginPath: noop,
    moveTo: (x, y) => calls.push(`M${x},${y}`),
    lineTo: (x, y) => calls.push(`L${x},${y}`),
    arc: (x, y, r, a0, a1, ccw) => calls.push(`A${x},${y},${r},${a0.toFixed(3)},${a1.toFixed(3)},${ccw === true}`),
    closePath: () => calls.push('Z'),
    quadraticCurveTo: noop,
    roundRect: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    measureText: () => ({ width: 0 }),
    calls,
  }
}

describe('sectorPath', () => {
  it('draws the hub as a plain disc', () => {
    const ctx = recorder()
    sectorPath(ctx, 100, 100, 0, 40, 0, TAU)
    // One full arc, no hole, no radial sides — a wedge's straight edges on a
    // full circle would be a visible seam across the middle of the hub.
    expect(ctx.calls.filter((c) => c.startsWith('A')).length).toBe(1)
    expect(ctx.calls.some((c) => c.startsWith('L'))).toBe(false)
  })

  it('draws a full generation as a ring with a hole', () => {
    const ctx = recorder()
    sectorPath(ctx, 100, 100, 20, 40, 0, TAU)
    const arcs = ctx.calls.filter((c) => c.startsWith('A'))
    expect(arcs.length).toBe(2)
    // The inner arc is wound the other way, so the fill leaves a hole rather
    // than painting over it.
    expect(arcs[1]!.endsWith('true')).toBe(true)
  })

  it('draws an ordinary wedge as two arcs joined by two radial sides', () => {
    const ctx = recorder()
    sectorPath(ctx, 0, 0, 10, 20, 0, Math.PI / 2)
    expect(ctx.calls.filter((c) => c.startsWith('A')).length).toBe(2)
    expect(ctx.calls.filter((c) => c.startsWith('L')).length).toBe(2)
    expect(ctx.calls.at(-1)).toBe('Z')
    // Starts on the inner arc at a0, so the shape closes cleanly.
    expect(ctx.calls[0]).toBe('M10,0')
  })
})

describe('normaliseUpright', () => {
  it('leaves an angle alone on the right-hand side of the wheel', () => {
    for (const a of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
      expect(normaliseUpright(a)).toBe(a)
    }
  })

  it('adds half a turn where text would read upside down', () => {
    for (const a of [Math.PI * 0.6, Math.PI, Math.PI * 1.4]) {
      expect(normaliseUpright(a)).toBe(a + Math.PI)
    }
  })

  it('handles angles past a full turn, and negative ones', () => {
    expect(normaliseUpright(Math.PI + TAU)).toBe(Math.PI + TAU + Math.PI)
    expect(normaliseUpright(-Math.PI)).toBe(-Math.PI + Math.PI)
  })
})

describe('lineHeightOf', () => {
  it('reads the px size out of a CSS font shorthand', () => {
    expect(lineHeightOf('14px system-ui, sans-serif')).toBeCloseTo(16.1)
    expect(lineHeightOf('bold 20px Inter')).toBeCloseTo(23)
  })

  it('falls back for a font with no px size', () => {
    expect(lineHeightOf('1em serif')).toBeCloseTo(16.1)
  })
})

describe('labelPlacement', () => {
  const LH = 16

  it('labels the hub horizontally through its middle', () => {
    const place = labelPlacement(0, 60, 0, TAU, LH)
    expect(place).not.toBeNull()
    expect(place!.x).toBe(0)
    expect(place!.y).toBe(0)
    expect(place!.angle).toBe(0)
    expect(place!.maxWidth).toBeCloseTo(120 - 2 * SECTOR_LABEL_PAD)
  })

  it('runs text along the ring on a sector wider than it is thick', () => {
    // A quarter turn at a large radius: plenty of arc, one ring thick.
    const place = labelPlacement(100, 130, 0, Math.PI / 2, LH)
    expect(place).not.toBeNull()
    // Tangential: turned a quarter turn from the sector's own mid-ray.
    const mid = Math.PI / 4
    expect(place!.angle).toBeCloseTo(normaliseUpright(mid + Math.PI / 2))
    expect(place!.maxWidth).toBeGreaterThan(0)
  })

  it('runs text outward along a tall, narrow sector', () => {
    // A thin slice of a thick ring, far enough out that the wedge is still
    // wider than a line of text where the text sits — the shape the outer
    // rings of a real wheel are made of.
    const place = labelPlacement(150, 250, 0, 0.12, LH)
    expect(place).not.toBeNull()
    expect(place!.angle).toBeCloseTo(normaliseUpright(0.06))
    // Bounded by the ring's thickness, not by its (much shorter) arc.
    expect(place!.maxWidth).toBeCloseTo(100 - 2 * SECTOR_LABEL_PAD)
  })

  it('keeps tangential text inside the sector rather than crediting the full arc', () => {
    // Half a turn of arc at r=100 is ~314 units long, but a STRAIGHT line at
    // mid-radius leaves the sector long before that. Crediting the arc length
    // is the bug that makes wide sectors spill their labels past the ring.
    const place = labelPlacement(90, 110, 0, Math.PI, LH)
    expect(place).not.toBeNull()
    expect(place!.maxWidth).toBeLessThan(Math.PI * 100)
  })

  it('skips a sector too thin to hold a line of text', () => {
    expect(labelPlacement(100, 108, 0, Math.PI / 2, LH)).toBeNull()
  })

  it('skips a sliver too narrow to hold a line of text', () => {
    // Thick enough radially, but the wedge is a hair wide at its inner edge —
    // radial text would not fit between its two sides.
    expect(labelPlacement(100, 200, 0, 0.005, LH)).toBeNull()
  })

  it('skips a collapsed sector outright', () => {
    expect(labelPlacement(100, 200, 1, 1, LH)).toBeNull()
    expect(labelPlacement(100, 100, 0, Math.PI, LH)).toBeNull()
  })
})
