import { describe, expect, it } from 'vitest'
import {
  centreOn,
  easeInOutCubic,
  fit,
  interpolate,
  pan,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomAt,
} from './viewport.js'

const LIMITS = { minK: 0.1, maxK: 4 }
const SIZE = { width: 800, height: 600 }

describe('coordinate conversion', () => {
  it('maps world to screen with scale then offset', () => {
    expect(worldToScreen({ x: 50, y: 20, k: 2 }, 10, 5)).toEqual({ x: 70, y: 30 })
  })

  it('round-trips through screenToWorld', () => {
    const camera = { x: -120, y: 40, k: 1.75 }
    const screen = worldToScreen(camera, 333, 777)
    const world = screenToWorld(camera, screen.x, screen.y)
    expect(world.x).toBeCloseTo(333, 9)
    expect(world.y).toBeCloseTo(777, 9)
  })

  it('round-trips within a small relative error across an extreme k sweep', () => {
    // Ordinary float64 rounding gets worse the further k sits from 1, so this
    // asserts a relative tolerance rather than exact/toBeCloseTo equality,
    // which would spuriously fail at the extremes of the sweep.
    const scales = [1e-8, 1e-4, 1e-2, 1, 1e2, 1e4, 1e8, 1e10, 1e12]
    const relativeTolerance = 1e-6
    for (const k of scales) {
      const camera = { x: -120, y: 40, k }
      const screen = worldToScreen(camera, 333, 777)
      const world = screenToWorld(camera, screen.x, screen.y)
      expect(Math.abs(world.x - 333) / 333).toBeLessThan(relativeTolerance)
      expect(Math.abs(world.y - 777) / 777).toBeLessThan(relativeTolerance)
    }
  })
})

describe('visibleRect', () => {
  it('returns the world rectangle currently on screen', () => {
    expect(visibleRect({ x: 0, y: 0, k: 2 }, SIZE)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 400,
      maxY: 300,
    })
  })

  it('accounts for a panned camera', () => {
    expect(visibleRect({ x: -200, y: -100, k: 1 }, SIZE)).toEqual({
      minX: 200,
      minY: 100,
      maxX: 1000,
      maxY: 700,
    })
  })

  it('handles a fractional k', () => {
    const rect = visibleRect({ x: 0, y: 0, k: 0.375 }, SIZE)
    expect(rect.minX).toBeCloseTo(0, 9)
    expect(rect.minY).toBeCloseTo(0, 9)
    expect(rect.maxX).toBeCloseTo(SIZE.width / 0.375, 9)
    expect(rect.maxY).toBeCloseTo(SIZE.height / 0.375, 9)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })
})

describe('pan', () => {
  it('shifts the offset in screen space and leaves zoom alone', () => {
    expect(pan({ x: 10, y: 10, k: 2 }, 5, -5)).toEqual({ x: 15, y: 5, k: 2 })
  })
})

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const before = { x: 0, y: 0, k: 1 }
    const world = screenToWorld(before, 300, 200)
    const after = zoomAt(before, 300, 200, 2, LIMITS)
    const screen = worldToScreen(after, world.x, world.y)
    expect(screen.x).toBeCloseTo(300, 9)
    expect(screen.y).toBeCloseTo(200, 9)
    expect(after.k).toBe(2)
  })

  it('clamps to maxK and stops moving once clamped', () => {
    const after = zoomAt({ x: 0, y: 0, k: 3 }, 400, 300, 10, LIMITS)
    expect(after.k).toBe(4)
  })

  it('clamps to minK', () => {
    const after = zoomAt({ x: 0, y: 0, k: 0.2 }, 400, 300, 0.01, LIMITS)
    expect(after.k).toBe(0.1)
  })

  it('is a no-op when already at the limit', () => {
    const at = { x: 33, y: 44, k: 4 }
    expect(zoomAt(at, 100, 100, 2, LIMITS)).toEqual(at)
  })

  it('returns a fresh object (not the same reference) even when already at the limit', () => {
    const at = { x: 33, y: 44, k: 4 }
    expect(zoomAt(at, 100, 100, 2, LIMITS)).not.toBe(at)
  })

  it('keeps the anchored world point fixed when clamped at maxK', () => {
    const before = { x: 0, y: 0, k: 3 }
    const world = screenToWorld(before, 400, 300)
    const after = zoomAt(before, 400, 300, 10, LIMITS)
    expect(after.k).toBe(4) // confirms the clamp actually engaged
    const screen = worldToScreen(after, world.x, world.y)
    expect(screen.x).toBeCloseTo(400, 9)
    expect(screen.y).toBeCloseTo(300, 9)
  })

  it('keeps the anchored world point fixed when clamped at minK', () => {
    const before = { x: 0, y: 0, k: 0.2 }
    const world = screenToWorld(before, 400, 300)
    const after = zoomAt(before, 400, 300, 0.01, LIMITS)
    expect(after.k).toBe(0.1) // confirms the clamp actually engaged
    const screen = worldToScreen(after, world.x, world.y)
    expect(screen.x).toBeCloseTo(400, 9)
    expect(screen.y).toBeCloseTo(300, 9)
  })

  it('keeps the anchored world point fixed when a factor partially overshoots the limit', () => {
    const before = { x: 10, y: -5, k: 3 }
    const world = screenToWorld(before, 250, 180)
    // k * factor = 4.5, which overshoots maxK (4) only slightly.
    const after = zoomAt(before, 250, 180, 1.5, LIMITS)
    expect(after.k).toBe(4)
    const screen = worldToScreen(after, world.x, world.y)
    expect(screen.x).toBeCloseTo(250, 9)
    expect(screen.y).toBeCloseTo(180, 9)
  })

  it('floors a minK of 0 to a positive k, producing a finite, non-inverted visibleRect', () => {
    const badLimits = { minK: 0, maxK: 4 }
    const after = zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 0, badLimits)
    expect(after.k).toBeGreaterThan(0)
    expect(Number.isFinite(after.k)).toBe(true)
    const rect = visibleRect(after, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('floors a negative minK to a positive k, producing a finite, non-inverted visibleRect', () => {
    const badLimits = { minK: -5, maxK: 4 }
    const after = zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 0, badLimits)
    expect(after.k).toBeGreaterThan(0)
    expect(Number.isFinite(after.k)).toBe(true)
    const rect = visibleRect(after, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('treats a maxK of 0 as bounded by the floored minK instead of winning outright', () => {
    const badLimits = { minK: 0.1, maxK: 0 }
    const after = zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 1, badLimits)
    expect(after.k).toBeGreaterThan(0)
    expect(Number.isFinite(after.k)).toBe(true)
    expect(after.k).toBe(0.1)
    const rect = visibleRect(after, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('treats a negative maxK as bounded by the floored minK instead of winning outright', () => {
    const badLimits = { minK: 0.1, maxK: -1 }
    const after = zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 1, badLimits)
    expect(after.k).toBeGreaterThan(0)
    expect(Number.isFinite(after.k)).toBe(true)
    expect(after.k).toBe(0.1)
    const rect = visibleRect(after, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('treats a NaN maxK as unbounded rather than poisoning the result', () => {
    const badLimits = { minK: 0.1, maxK: NaN }
    const after = zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 1, badLimits)
    expect(after.k).toBeGreaterThan(0)
    expect(Number.isFinite(after.k)).toBe(true)
    expect(after.k).toBe(1) // camera.k(1) * factor(1), unbounded above
    expect(Number.isFinite(after.x)).toBe(true)
    expect(Number.isFinite(after.y)).toBe(true)
    const rect = visibleRect(after, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('resolves inverted limits (maxK < minK) to the floored minK rather than the smaller maxK', () => {
    const badLimits = { minK: 0.5, maxK: 0.2 }
    const after = zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 1, badLimits)
    expect(after.k).toBeGreaterThan(0)
    expect(Number.isFinite(after.k)).toBe(true)
    expect(after.k).toBe(0.5)
    const rect = visibleRect(after, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })
})

describe('fit', () => {
  it('scales content to the smaller axis and centres it', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, SIZE, 0, LIMITS)
    expect(camera.k).toBe(1.5) // 600 / 400 is the binding axis
    const topLeft = worldToScreen(camera, 0, 0)
    const bottomRight = worldToScreen(camera, 400, 400)
    expect(topLeft.y).toBeCloseTo(0, 9)
    expect(bottomRight.y).toBeCloseTo(600, 9)
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(400, 9)
  })

  it('honours padding', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, SIZE, 50, LIMITS)
    expect(camera.k).toBe(1.25) // (600 - 100) / 400
  })

  it('clamps the fit scale to maxK for tiny content', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, SIZE, 0, LIMITS)
    expect(camera.k).toBe(4)
  })

  it('returns an identity-ish camera for empty bounds', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, SIZE, 0, LIMITS)
    expect(camera.k).toBe(1)
    expect(camera.x).toBe(400)
    expect(camera.y).toBe(300)
  })

  it('returns an identity-ish camera for inverted bounds (maxX < minX)', () => {
    const camera = fit({ minX: 400, minY: 400, maxX: 0, maxY: 0 }, SIZE, 0, LIMITS)
    expect(camera.k).toBe(1)
    expect(Number.isFinite(camera.x)).toBe(true)
    expect(Number.isFinite(camera.y)).toBe(true)
  })

  it('handles a zero-size viewport without producing NaN or Infinity', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, { width: 0, height: 0 }, 0, LIMITS)
    expect(Number.isFinite(camera.k)).toBe(true)
    expect(Number.isFinite(camera.x)).toBe(true)
    expect(Number.isFinite(camera.y)).toBe(true)
  })

  it('floors the available size at 1 when the viewport is smaller than twice the padding', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, { width: 100, height: 100 }, 60, LIMITS)
    expect(Number.isFinite(camera.k)).toBe(true)
    expect(Number.isFinite(camera.x)).toBe(true)
    expect(Number.isFinite(camera.y)).toBe(true)
  })

  // Bounds of 1e10 x 1e10 against the 800x600 SIZE fixture drive `raw` to
  // 6e-8 (800/1e10 vs 600/1e10, the latter binds), which sits below
  // MIN_POSITIVE_K (1e-6). That's what makes the floor actually engage here:
  // a bad `minK` alone never changes the outcome when `raw` is positive
  // (Math.max(minK, raw) === raw for any minK <= raw), which is always true
  // for non-degenerate bounds. Only driving `raw` itself below the floor lets
  // these tests distinguish "floored to MIN_POSITIVE_K" from "passed raw
  // through unclamped." Verified: with the MIN_POSITIVE_K floor temporarily
  // removed from `fit`, both tests below fail (k comes out as 6e-8, not 1e-6).
  it('floors a minK of 0 to a positive k when raw itself falls below the floor', () => {
    const badLimits = { minK: 0, maxK: 4 }
    const camera = fit({ minX: 0, minY: 0, maxX: 1e10, maxY: 1e10 }, SIZE, 0, badLimits)
    expect(camera.k).toBeGreaterThan(0)
    expect(Number.isFinite(camera.k)).toBe(true)
    expect(camera.k).toBe(1e-6)
    const rect = visibleRect(camera, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('floors a negative minK to a positive k when raw itself falls below the floor', () => {
    const badLimits = { minK: -5, maxK: 4 }
    const camera = fit({ minX: 0, minY: 0, maxX: 1e10, maxY: 1e10 }, SIZE, 0, badLimits)
    expect(camera.k).toBeGreaterThan(0)
    expect(Number.isFinite(camera.k)).toBe(true)
    expect(camera.k).toBe(1e-6)
    const rect = visibleRect(camera, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('treats a maxK of 0 as bounded by the floored minK instead of winning outright', () => {
    const badLimits = { minK: 0.1, maxK: 0 }
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, SIZE, 0, badLimits)
    expect(camera.k).toBeGreaterThan(0)
    expect(Number.isFinite(camera.k)).toBe(true)
    expect(camera.k).toBe(0.1)
    const rect = visibleRect(camera, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('treats a negative maxK as bounded by the floored minK instead of winning outright', () => {
    const badLimits = { minK: 0.1, maxK: -1 }
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, SIZE, 0, badLimits)
    expect(camera.k).toBeGreaterThan(0)
    expect(Number.isFinite(camera.k)).toBe(true)
    expect(camera.k).toBe(0.1)
    const rect = visibleRect(camera, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('treats a NaN maxK as unbounded rather than poisoning the result', () => {
    const badLimits = { minK: 0.1, maxK: NaN }
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, SIZE, 0, badLimits)
    expect(camera.k).toBeGreaterThan(0)
    expect(Number.isFinite(camera.k)).toBe(true)
    expect(camera.k).toBe(1.5) // raw = min(800/400, 600/400) = 1.5, unbounded above
    expect(Number.isFinite(camera.x)).toBe(true)
    expect(Number.isFinite(camera.y)).toBe(true)
    const rect = visibleRect(camera, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })

  it('resolves inverted limits (maxK < minK) to the floored minK rather than the smaller maxK', () => {
    const badLimits = { minK: 2, maxK: 1 }
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, SIZE, 0, badLimits)
    expect(camera.k).toBeGreaterThan(0)
    expect(Number.isFinite(camera.k)).toBe(true)
    expect(camera.k).toBe(2)
    const rect = visibleRect(camera, SIZE)
    expect(Number.isFinite(rect.minX)).toBe(true)
    expect(Number.isFinite(rect.maxX)).toBe(true)
    expect(Number.isFinite(rect.minY)).toBe(true)
    expect(Number.isFinite(rect.maxY)).toBe(true)
    expect(rect.minX).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY).toBeLessThanOrEqual(rect.maxY)
  })
})

describe('ZoomLimits resolution', () => {
  // Both bounds are swept, not just maxK. Two earlier fix rounds each guarded one
  // side and left the other open, because `Math.max(x, NaN)` is `NaN` — so a single
  // bad field poisons the clamp no matter how well the other one is defended.
  const BAD_VALUES = [0, -1, 5, NaN, Infinity, -Infinity]

  function assertUsable(camera: { x: number; y: number; k: number }, label: string) {
    expect(Number.isFinite(camera.k), `${label}: k finite`).toBe(true)
    expect(camera.k, `${label}: k positive`).toBeGreaterThan(0)
    expect(Number.isFinite(camera.x), `${label}: x finite`).toBe(true)
    expect(Number.isFinite(camera.y), `${label}: y finite`).toBe(true)

    const rect = visibleRect(camera, SIZE)
    expect(Number.isFinite(rect.minX), `${label}: rect finite`).toBe(true)
    expect(Number.isFinite(rect.maxY), `${label}: rect finite`).toBe(true)
    expect(rect.minX, `${label}: rect not inverted`).toBeLessThanOrEqual(rect.maxX)
    expect(rect.minY, `${label}: rect not inverted`).toBeLessThanOrEqual(rect.maxY)
  }

  it('yields a usable camera from zoomAt for every minK/maxK combination', () => {
    let checked = 0
    for (const minK of BAD_VALUES) {
      for (const maxK of BAD_VALUES) {
        const after = zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 2, { minK, maxK })
        assertUsable(after, `zoomAt minK=${minK} maxK=${maxK}`)
        checked++
      }
    }
    expect(checked).toBe(BAD_VALUES.length ** 2)
  })

  it('yields a usable camera from fit for every minK/maxK combination', () => {
    let checked = 0
    for (const minK of BAD_VALUES) {
      for (const maxK of BAD_VALUES) {
        const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, SIZE, 0, { minK, maxK })
        assertUsable(camera, `fit minK=${minK} maxK=${maxK}`)
        checked++
      }
    }
    expect(checked).toBe(BAD_VALUES.length ** 2)
  })

  it('does not let a non-finite minK drag maxK up with it', () => {
    // Math.max(Infinity, 4) is Infinity, so folding an unusable minK into maxK
    // silently discards a perfectly good upper bound.
    const after = zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 100, { minK: Infinity, maxK: 4 })
    expect(after.k).toBe(4)
  })

  it('leaves sane limits behaving exactly as before', () => {
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 2, LIMITS).k).toBe(2)
    expect(zoomAt({ x: 0, y: 0, k: 3 }, 400, 300, 10, LIMITS).k).toBe(4)
    expect(zoomAt({ x: 0, y: 0, k: 0.2 }, 400, 300, 0.01, LIMITS).k).toBe(0.1)
  })
})

describe('centreOn', () => {
  it('centres the given bounds without changing zoom', () => {
    const camera = centreOn({ x: 0, y: 0, k: 2 }, { minX: 100, minY: 100, maxX: 200, maxY: 200 }, SIZE)
    expect(camera.k).toBe(2)
    const centre = worldToScreen(camera, 150, 150)
    expect(centre.x).toBeCloseTo(400, 9)
    expect(centre.y).toBeCloseTo(300, 9)
  })
})

describe('interpolate', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    const from = { x: 0, y: 0, k: 1 }
    const to = { x: 100, y: 50, k: 4 }
    expect(interpolate(from, to, 0)).toEqual(from)
    expect(interpolate(from, to, 1)).toEqual(to)
  })

  it('returns fresh objects at the endpoints, not references to the inputs', () => {
    const from = { x: 0, y: 0, k: 1 }
    const to = { x: 100, y: 50, k: 4 }
    expect(interpolate(from, to, 0)).not.toBe(from)
    expect(interpolate(from, to, 1)).not.toBe(to)
  })

  it('interpolates zoom geometrically so the rate feels constant', () => {
    const mid = interpolate({ x: 0, y: 0, k: 1 }, { x: 0, y: 0, k: 4 }, 0.5)
    expect(mid.k).toBeCloseTo(2, 9) // sqrt(1 * 4), not (1 + 4) / 2
  })

  it('clamps t outside 0..1', () => {
    const from = { x: 0, y: 0, k: 1 }
    const to = { x: 100, y: 0, k: 2 }
    expect(interpolate(from, to, -1)).toEqual(from)
    expect(interpolate(from, to, 5)).toEqual(to)
  })
})

describe('easeInOutCubic', () => {
  it('pins the endpoints and the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9)
  })

  it('is monotonic', () => {
    let prev = -1
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeInOutCubic(Math.min(t, 1))
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})
