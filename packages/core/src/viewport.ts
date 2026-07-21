import type { Bounds } from './types.js'

/** screen = world * k + (x, y). x and y are screen-space offsets. */
export interface Camera {
  x: number
  y: number
  k: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface ZoomLimits {
  minK: number
  maxK: number
}

/**
 * Smallest `k` that `zoomAt` and `fit` will ever hand out, regardless of what
 * `limits.minK` says. `screenToWorld` divides by `camera.k`, and both `zoomAt`
 * and `visibleRect` call it internally, so a `k <= 0` camera turns the very
 * next coordinate conversion into `Infinity`/`NaN`, or — for negative `k` — a
 * silently inverted `Bounds` (`minX > maxX`) that a culling consumer can't
 * detect. `ZoomLimits` is a plain data object with no way to express
 * `minK > 0` at the type level, so callers can and do pass `minK: 0` or
 * negative values by mistake.
 */
const MIN_POSITIVE_K = 1e-6

/**
 * Derives a usable `{ minK, maxK }` pair from a caller-supplied `ZoomLimits`.
 *
 * Both bounds get the same treatment, deliberately: `Math.max` returns `NaN` if
 * either argument is `NaN`, so guarding one bound and not the other still lets a
 * single bad field poison the clamp. A non-finite bound is discarded outright
 * rather than folded in — `NaN` and `Infinity` carry no usable limit, and
 * `minK: Infinity` would otherwise drag `maxK` up with it.
 *
 * The floored `minK` doubles as a lower bound on `maxK`, which is what makes an
 * inverted config (`maxK < minK`) resolve to a sane clamp instead of an empty one.
 */
function resolveLimits(limits: ZoomLimits): { minK: number; maxK: number } {
  const minK = Number.isFinite(limits.minK)
    ? Math.max(MIN_POSITIVE_K, limits.minK)
    : MIN_POSITIVE_K
  const maxK = Number.isFinite(limits.maxK) ? Math.max(minK, limits.maxK) : Infinity
  return { minK, maxK }
}

export function worldToScreen(camera: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * camera.k + camera.x, y: wy * camera.k + camera.y }
}

export function screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - camera.x) / camera.k, y: (sy - camera.y) / camera.k }
}

/** The world-space rectangle currently on screen — the culling query rect. */
export function visibleRect(camera: Camera, size: ViewportSize): Bounds {
  const topLeft = screenToWorld(camera, 0, 0)
  const bottomRight = screenToWorld(camera, size.width, size.height)
  return { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y }
}

export function pan(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x + dx, y: camera.y + dy, k: camera.k }
}

/**
 * Zooms by `factor` about a screen-space anchor, keeping the world point under
 * that anchor stationary. Returns the input unchanged when already clamped.
 *
 * Guarantees a finite, positive result `k` for any `ZoomLimits` — see
 * {@link resolveLimits} for how non-positive, non-finite, and inverted configs
 * are resolved.
 *
 * That guarantee covers `limits` only. This function does not sanitize its
 * other inputs: `camera.k` and `factor` are both assumed to be finite, and a
 * `NaN` in either still yields a `NaN` camera.
 */
export function zoomAt(
  camera: Camera,
  sx: number,
  sy: number,
  factor: number,
  limits: ZoomLimits,
): Camera {
  const { minK, maxK } = resolveLimits(limits)
  const k = Math.min(maxK, Math.max(minK, camera.k * factor))
  if (k === camera.k) return { ...camera }
  const world = screenToWorld(camera, sx, sy)
  return { x: sx - world.x * k, y: sy - world.y * k, k }
}

/**
 * Scales `bounds` to fill `size` minus `padding` on every edge, then centres it.
 *
 * Guarantees a finite, positive `k` for any `ZoomLimits` — see
 * {@link resolveLimits} for how non-positive, non-finite, and inverted configs
 * are resolved.
 */
export function fit(
  bounds: Bounds,
  size: ViewportSize,
  padding: number,
  limits: ZoomLimits,
): Camera {
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  if (w <= 0 || h <= 0) {
    return { x: size.width / 2, y: size.height / 2, k: 1 }
  }
  const available = {
    width: Math.max(1, size.width - padding * 2),
    height: Math.max(1, size.height - padding * 2),
  }
  const raw = Math.min(available.width / w, available.height / h)
  const { minK, maxK } = resolveLimits(limits)
  const k = Math.min(maxK, Math.max(minK, raw))
  return centreOn({ x: 0, y: 0, k }, bounds, size)
}

/** Centres `bounds` in the viewport at the camera's current zoom. */
export function centreOn(camera: Camera, bounds: Bounds, size: ViewportSize): Camera {
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    x: size.width / 2 - cx * camera.k,
    y: size.height / 2 - cy * camera.k,
    k: camera.k,
  }
}

/**
 * Samples the camera between two states. Zoom is interpolated geometrically:
 * halfway between 1x and 4x is 2x, not 2.5x, which is what reads as a constant
 * zoom rate to the eye.
 */
export function interpolate(from: Camera, to: Camera, t: number): Camera {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t
  if (clamped === 0) return { ...from }
  if (clamped === 1) return { ...to }
  return {
    x: from.x + (to.x - from.x) * clamped,
    y: from.y + (to.y - from.y) * clamped,
    k: from.k * Math.pow(to.k / from.k, clamped),
  }
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
