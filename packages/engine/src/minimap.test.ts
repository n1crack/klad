import { describe, expect, it } from 'vitest'
import {
  computeMinimapTransform,
  computeSilhouette,
  minimapToWorld,
  viewportRectInMinimap,
  worldToMinimap,
} from './minimap.js'
import type { Bounds } from './types.js'

const SIZE = { width: 200, height: 120 }

describe('computeMinimapTransform', () => {
  it('fits bounds inside the minimap, aspect-preserved and centred', () => {
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 500 }
    const t = computeMinimapTransform(bounds, SIZE)
    // width-constrained: 200/1000 = 0.2, height would allow 120/500 = 0.24.
    expect(t.scale).toBeCloseTo(0.2, 9)
    // Drawn height is 500 * 0.2 = 100, centred in 120 -> 10px top margin.
    const topLeft = worldToMinimap(t, 0, 0)
    const bottomRight = worldToMinimap(t, 1000, 500)
    expect(topLeft.x).toBeCloseTo(0, 9)
    expect(topLeft.y).toBeCloseTo(10, 9)
    expect(bottomRight.x).toBeCloseTo(200, 9)
    expect(bottomRight.y).toBeCloseTo(110, 9)
  })

  it('respects padding on every edge', () => {
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const t = computeMinimapTransform(bounds, { width: 100, height: 100 }, 10)
    const topLeft = worldToMinimap(t, 0, 0)
    const bottomRight = worldToMinimap(t, 100, 100)
    expect(topLeft.x).toBeCloseTo(10, 9)
    expect(topLeft.y).toBeCloseTo(10, 9)
    expect(bottomRight.x).toBeCloseTo(90, 9)
    expect(bottomRight.y).toBeCloseTo(90, 9)
  })

  it('falls back to a centred unit scale for degenerate (zero-area) bounds', () => {
    const bounds: Bounds = { minX: 5, minY: 5, maxX: 5, maxY: 5 }
    const t = computeMinimapTransform(bounds, SIZE)
    expect(t.scale).toBe(1)
    expect(t.offsetX).toBe(SIZE.width / 2)
    expect(t.offsetY).toBe(SIZE.height / 2)
  })

  it('never produces a non-positive scale, even for inverted bounds', () => {
    // minX > maxX shouldn't happen from a real layout, but a defensive check
    // costs nothing: w <= 0 must hit the same fallback as w === 0.
    const bounds: Bounds = { minX: 100, minY: 0, maxX: 0, maxY: 50 }
    const t = computeMinimapTransform(bounds, SIZE)
    expect(t.scale).toBeGreaterThan(0)
  })
})

describe('worldToMinimap / minimapToWorld round-trip', () => {
  const bounds: Bounds = { minX: -300, minY: -50, maxX: 2000, maxY: 900 }

  it('round-trips arbitrary world points through minimap space and back', () => {
    const t = computeMinimapTransform(bounds, SIZE, 8)
    const points = [
      [0, 0],
      [-300, -50],
      [2000, 900],
      [850, 425],
      [-299.5, 899.9],
    ]
    for (const [wx, wy] of points) {
      const m = worldToMinimap(t, wx!, wy!)
      const back = minimapToWorld(t, m.x, m.y)
      expect(back.x).toBeCloseTo(wx!, 9)
      expect(back.y).toBeCloseTo(wy!, 9)
    }
  })

  it('round-trips across a sweep of chart sizes and minimap sizes', () => {
    const sweeps: Array<{ bounds: Bounds; size: { width: number; height: number } }> = [
      { bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 }, size: { width: 40, height: 40 } },
      { bounds: { minX: 0, minY: 0, maxX: 500_000, maxY: 3_000 }, size: { width: 320, height: 200 } },
      { bounds: { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }, size: { width: 150, height: 150 } },
    ]
    for (const { bounds: b, size } of sweeps) {
      const t = computeMinimapTransform(b, size)
      for (const [wx, wy] of [
        [b.minX, b.minY],
        [b.maxX, b.maxY],
        [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2],
      ]) {
        const m = worldToMinimap(t, wx!, wy!)
        const back = minimapToWorld(t, m.x, m.y)
        expect(Math.abs(back.x - wx!) / Math.max(1, Math.abs(wx!))).toBeLessThan(1e-6)
        expect(Math.abs(back.y - wy!) / Math.max(1, Math.abs(wy!))).toBeLessThan(1e-6)
      }
    }
  })
})

describe('viewportRectInMinimap', () => {
  it('maps the camera-visible world rect into minimap space consistently with worldToMinimap', () => {
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 4000, maxY: 2000 }
    const t = computeMinimapTransform(bounds, SIZE)
    const camera = { x: -100, y: -50, k: 0.5 }
    const viewport = { width: 800, height: 600 }

    const rect = viewportRectInMinimap(t, camera, viewport)

    // visibleRect at this camera: topLeft = ((0 - -100)/0.5, (0 - -50)/0.5) = (200, 100)
    // bottomRight = ((800 - -100)/0.5, (600 - -50)/0.5) = (1800, 1300)
    const expectedTopLeft = worldToMinimap(t, 200, 100)
    const expectedBottomRight = worldToMinimap(t, 1800, 1300)
    expect(rect.minX).toBeCloseTo(expectedTopLeft.x, 9)
    expect(rect.minY).toBeCloseTo(expectedTopLeft.y, 9)
    expect(rect.maxX).toBeCloseTo(expectedBottomRight.x, 9)
    expect(rect.maxY).toBeCloseTo(expectedBottomRight.y, 9)
    expect(rect.minX).toBeLessThan(rect.maxX)
    expect(rect.minY).toBeLessThan(rect.maxY)
  })
})

describe('computeSilhouette', () => {
  it('marks the cell a single box lands on and leaves the rest empty', () => {
    // One box near the top-left of a 100x100 world, mapped 1:1 onto a 10x10 grid.
    const boxes = new Float64Array([5, 5, 8, 8])
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const result = computeSilhouette(boxes, bounds, { width: 10, height: 10 }, { blur: 0 })

    expect(result.width).toBe(10)
    expect(result.height).toBe(10)
    // Box spans world [5,13]x[5,13] -> grid (scale 0.1) spans [0.5,1.3] -> cell (0,0) only.
    expect(result.alpha[0]).toBeGreaterThan(0)
    // Far corner should stay empty.
    expect(result.alpha[9 * 10 + 9]).toBe(0)
  })

  it('sums overlapping boxes via the difference-array/prefix-sum reconstruction', () => {
    // Two boxes both fully covering cell (1,1) in a 4x4 grid over a 4x4 world (1:1 scale).
    const boxes = new Float64Array([1, 1, 2, 2, 1.2, 1.2, 1.5, 1.5])
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 4, maxY: 4 }
    const result = computeSilhouette(boxes, bounds, { width: 4, height: 4 }, { blur: 0, saturateAt: 2 })
    // Cell (1,1) is covered by both boxes -> saturateAt=2 means it should be fully opaque.
    expect(result.alpha[1 * 4 + 1]).toBe(255)
  })

  it('saturates alpha instead of overflowing past many overlapping boxes', () => {
    const n = 20
    const boxes = new Float64Array(n * 4)
    for (let i = 0; i < n; i++) {
      boxes[i * 4] = 1
      boxes[i * 4 + 1] = 1
      boxes[i * 4 + 2] = 1
      boxes[i * 4 + 3] = 1
    }
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 4, maxY: 4 }
    const result = computeSilhouette(boxes, bounds, { width: 4, height: 4 }, { blur: 0, saturateAt: 3 })
    expect(result.alpha[1 * 4 + 1]).toBe(255)
    expect(result.alpha[1 * 4 + 1]).toBeLessThanOrEqual(255)
  })

  it('registers a box narrower than one minimap pixel instead of vanishing', () => {
    // World is 1000 units wide onto a 10px grid (100 units/cell); a box only
    // 2 units wide would occupy 0.02 of a cell under naive rounding.
    const boxes = new Float64Array([500, 500, 2, 2])
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
    const result = computeSilhouette(boxes, bounds, { width: 10, height: 10 }, { blur: 0 })
    const total = result.alpha.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(0)
  })

  it('softens hard edges when blur is enabled', () => {
    const boxes = new Float64Array([4, 4, 2, 2])
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    const sharp = computeSilhouette(boxes, bounds, { width: 10, height: 10 }, { blur: 0 })
    const soft = computeSilhouette(boxes, bounds, { width: 10, height: 10 }, { blur: 1 })

    // A cell just outside the hard box footprint is exactly 0 without blur...
    expect(sharp.alpha[4 * 10 + 3]).toBe(0)
    // ...but picks up some coverage once blur spreads the neighbouring cell's
    // alpha into it.
    expect(soft.alpha[4 * 10 + 3]).toBeGreaterThan(0)
  })

  it('ignores zero-size and negative-size boxes without throwing', () => {
    const boxes = new Float64Array([0, 0, 0, 5, 10, 10, -3, 4])
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 }
    expect(() => computeSilhouette(boxes, bounds, { width: 8, height: 8 })).not.toThrow()
  })

  it('clips boxes that fall outside the layout bounds instead of crashing', () => {
    const boxes = new Float64Array([-500, -500, 10, 10, 10000, 10000, 10, 10])
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(() => computeSilhouette(boxes, bounds, { width: 8, height: 8 })).not.toThrow()
  })

  it('produces an all-empty grid for an empty tree', () => {
    const boxes = new Float64Array(0)
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    const result = computeSilhouette(boxes, bounds, SIZE)
    expect(result.alpha.every((a) => a === 0)).toBe(true)
  })

  it('rounds a fractional or sub-1 requested size up to at least one cell per axis', () => {
    const boxes = new Float64Array([0, 0, 1, 1])
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const result = computeSilhouette(boxes, bounds, { width: 0, height: 0.4 })
    expect(result.width).toBeGreaterThanOrEqual(1)
    expect(result.height).toBeGreaterThanOrEqual(1)
  })

  it('carries the transform used, consistent with computeMinimapTransform', () => {
    const boxes = new Float64Array([0, 0, 10, 10])
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 }
    const result = computeSilhouette(boxes, bounds, SIZE)
    const expected = computeMinimapTransform(bounds, SIZE, 0)
    expect(result.transform).toEqual(expected)
  })
})
