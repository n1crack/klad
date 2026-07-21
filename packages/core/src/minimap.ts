import type { Bounds } from './types.js'
import type { Camera, ViewportSize } from './viewport.js'
import { visibleRect } from './viewport.js'

/** Pixel dimensions of the minimap surface a host wants a silhouette for. */
export interface MinimapSize {
  width: number
  height: number
}

/**
 * Uniform world -> minimap affine map: `minimapCoord = worldCoord * scale + offset`,
 * one `offset` per axis. Aspect-preserving (a single `scale` for both axes) and
 * centred, the same way `fit()` in viewport.ts centres a camera on `bounds` —
 * this is the minimap's read-only equivalent, it never mutates a camera.
 */
export interface MinimapTransform {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * Derives the world->minimap transform that fits `bounds` inside `size` minus
 * `padding` on every edge, preserving aspect ratio and centring the result —
 * mirrors `fit()`'s box-fitting maths exactly, but returns a reusable
 * transform instead of a `Camera`.
 *
 * A degenerate `bounds` (zero or negative area — an empty tree, or a single
 * zero-size box) falls back to `scale: 1` centred on the minimap, the same
 * failsafe `fit()` uses for the same condition, rather than dividing by zero.
 */
export function computeMinimapTransform(
  bounds: Bounds,
  size: MinimapSize,
  padding = 0,
): MinimapTransform {
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  if (w <= 0 || h <= 0) {
    return { scale: 1, offsetX: size.width / 2, offsetY: size.height / 2 }
  }
  const availW = Math.max(1, size.width - padding * 2)
  const availH = Math.max(1, size.height - padding * 2)
  const scale = Math.min(availW / w, availH / h)
  const drawW = w * scale
  const drawH = h * scale
  return {
    scale,
    offsetX: (size.width - drawW) / 2 - bounds.minX * scale,
    offsetY: (size.height - drawH) / 2 - bounds.minY * scale,
  }
}

/** World point -> minimap-space point (e.g. for placing a marker). */
export function worldToMinimap(t: MinimapTransform, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * t.scale + t.offsetX, y: wy * t.scale + t.offsetY }
}

/**
 * Minimap-space point -> world point. Exact inverse of `worldToMinimap` for
 * any transform this module produces (`scale` is always > 0, see
 * `computeMinimapTransform`) — this is what a click-to-pan handler needs: the
 * world point under the pointer, to hand to `centreOn` (viewport.ts) alongside
 * the current camera.
 */
export function minimapToWorld(t: MinimapTransform, mx: number, my: number): { x: number; y: number } {
  return { x: (mx - t.offsetX) / t.scale, y: (my - t.offsetY) / t.scale }
}

/**
 * The viewport rectangle — what the main chart currently shows — expressed in
 * minimap space, so a host can draw it as an overlay rect on top of a
 * silhouette. This is the only part of the minimap that changes per frame,
 * and it is cheap: a `visibleRect` call plus two point transforms, no
 * silhouette work.
 *
 * Corner order is preserved (`minX < maxX`, `minY < maxY`) as long as
 * `camera.k > 0`, which is `visibleRect`'s own contract (see viewport.ts) —
 * this function does not re-validate it.
 */
export function viewportRectInMinimap(
  t: MinimapTransform,
  camera: Camera,
  viewport: ViewportSize,
): Bounds {
  const world = visibleRect(camera, viewport)
  const topLeft = worldToMinimap(t, world.minX, world.minY)
  const bottomRight = worldToMinimap(t, world.maxX, world.maxY)
  return { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y }
}

export interface SilhouetteOptions {
  /**
   * Margin, in minimap pixels, left empty around the fitted silhouette.
   * Default 0.
   */
  padding: number
  /**
   * Box-blur radius, in grid cells, applied to soften the coverage ramp into
   * something that reads as a soft mass rather than a hard-edged bitmap.
   * 0 disables blurring. Default 1.
   */
  blur: number
  /**
   * Number of overlapping boxes landing on one cell at which that cell's
   * alpha saturates to fully opaque. Past this many stacked boxes a cell
   * reads as "solid" rather than getting proportionally darker forever.
   * Default 3.
   */
  saturateAt: number
}

export const DEFAULT_SILHOUETTE_OPTIONS: SilhouetteOptions = { padding: 0, blur: 1, saturateAt: 3 }

export interface Silhouette {
  width: number
  height: number
  /**
   * Row-major coverage alpha, one byte per cell (`alpha[y * width + x]`),
   * 0 = empty, 255 = fully covered. A host paints this directly as an
   * ImageData alpha channel over a solid fill colour, or reads individual
   * cells to draw filled rects — no further processing required.
   */
  alpha: Uint8ClampedArray
  /** The transform used to build this silhouette; reuse it for hit-testing
   * and for `viewportRectInMinimap` so both stay in the same space. */
  transform: MinimapTransform
}

/**
 * Rasterizes the occupied area of a laid-out tree into a small coverage grid
 * at minimap resolution — the "filled silhouette" the design calls for,
 * not a shrunken redraw of every box. Call this once per relayout; the
 * result is meant to be blitted every frame, never recomputed per frame.
 *
 * `boxes` is the same flat `[x, y, w, h]` per-node layout produced by
 * `layout()` (see layout/tidy.ts) or the engine's `.boxes` getter; `bounds`
 * is the matching layout bounds. Iteration is a single flat pass over
 * `boxes`, driven by array index, not tree structure — no recursion, so tree
 * depth (up to 50,000) has no effect on this function's stack usage.
 *
 * Complexity is O(nodes + minimapPixels), not O(nodes * minimapPixels):
 * each box is "painted" onto the grid in O(1) via a 2D difference array
 * (the four-corner trick below), regardless of how many grid cells it
 * covers. A single O(pixels) prefix-sum pass afterwards reconstructs the
 * actual per-cell coverage count. This matters because most boxes shrink to
 * a fraction of a minimap pixel (that's the whole reason a silhouette is
 * needed instead of a miniature), but nothing here assumes that: a handful
 * of very large boxes (e.g. wide top-level nodes) covering most of the grid
 * would blow up a naive "loop over every cell a box touches" approach to
 * O(nodes * pixels); the difference-array approach costs the same O(1) per
 * box regardless of the box's footprint.
 */
export function computeSilhouette(
  boxes: Float64Array,
  bounds: Bounds,
  size: MinimapSize,
  options: Partial<SilhouetteOptions> = {},
): Silhouette {
  const padding = options.padding ?? DEFAULT_SILHOUETTE_OPTIONS.padding
  const blur = Math.max(0, Math.floor(options.blur ?? DEFAULT_SILHOUETTE_OPTIONS.blur))
  const saturateAt = Math.max(1, options.saturateAt ?? DEFAULT_SILHOUETTE_OPTIONS.saturateAt)

  const gw = Math.max(1, Math.round(size.width))
  const gh = Math.max(1, Math.round(size.height))
  const transform = computeMinimapTransform(bounds, { width: gw, height: gh }, padding)

  // 2D difference array over grid CORNERS (one wider/taller than the grid
  // itself), so a rectangular box update never has to touch more than 4
  // cells: += at (x0,y0) and (x1,y1), -= at (x0,y1) and (y0,x1). A full 2D
  // prefix sum afterwards (row-wise, then column-wise) turns those corner
  // deltas back into a per-cell coverage count — the standard summed-area
  // trick for O(1) rectangle-add / O(pixels) reconstruction.
  const diffW = gw + 1
  const diffH = gh + 1
  const diff = new Int32Array(diffW * diffH)

  const count = Math.floor(boxes.length / 4)
  for (let i = 0; i < count; i++) {
    const o = i * 4
    const bx = boxes[o]!
    const by = boxes[o + 1]!
    const bw = boxes[o + 2]!
    const bh = boxes[o + 3]!
    if (!(bw > 0) || !(bh > 0)) continue // skips zero/negative-size and NaN boxes alike

    const p0 = worldToMinimap(transform, bx, by)
    const p1 = worldToMinimap(transform, bx + bw, by + bh)

    let gx0 = Math.floor(Math.min(p0.x, p1.x))
    let gy0 = Math.floor(Math.min(p0.y, p1.y))
    let gx1 = Math.ceil(Math.max(p0.x, p1.x))
    let gy1 = Math.ceil(Math.max(p0.y, p1.y))
    // A box narrower than one minimap pixel must still register as at least
    // one cell — that is the entire point of a coverage-grid silhouette
    // over a naive miniature: mass at this scale is about presence, not
    // exact sub-pixel geometry.
    if (gx1 <= gx0) gx1 = gx0 + 1
    if (gy1 <= gy0) gy1 = gy0 + 1
    gx0 = Math.max(0, Math.min(gw, gx0))
    gx1 = Math.max(0, Math.min(gw, gx1))
    gy0 = Math.max(0, Math.min(gh, gy0))
    gy1 = Math.max(0, Math.min(gh, gy1))
    if (gx0 >= gx1 || gy0 >= gy1) continue // fully clipped outside the grid

    diff[gy0 * diffW + gx0]! += 1
    diff[gy0 * diffW + gx1]! -= 1
    diff[gy1 * diffW + gx0]! -= 1
    diff[gy1 * diffW + gx1]! += 1
  }

  // Row-wise prefix sum, full diffW width (including the extra corner
  // column) so the `-1`s placed at gx1 == gw still cancel correctly.
  for (let y = 0; y < diffH; y++) {
    const rowBase = y * diffW
    let running = 0
    for (let x = 0; x < diffW; x++) {
      running += diff[rowBase + x]!
      diff[rowBase + x] = running
    }
  }
  // Column-wise prefix sum, same reasoning for the extra corner row.
  for (let x = 0; x < diffW; x++) {
    let running = 0
    for (let y = 0; y < diffH; y++) {
      const idx = y * diffW + x
      running += diff[idx]!
      diff[idx] = running
    }
  }

  // Crop the (gw+1) x (gh+1) reconstruction down to the gw x gh grid a host
  // actually asked for, converting counts to a 0..1 coverage ratio as we go.
  // Annotated as the bare (ArrayBufferLike-backed) `Float64Array` rather
  // than left to infer the concrete ArrayBuffer-backed type: `boxBlur` below
  // is typed with the same bare form, and TS 5.9 treats those as distinct
  // generic instantiations that don't assign into each other without this.
  let ratio: Float64Array = new Float64Array(gw * gh)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const raw = diff[y * diffW + x]!
      ratio[y * gw + x] = Math.min(1, Math.max(0, raw) / saturateAt)
    }
  }

  if (blur > 0) ratio = boxBlur(ratio, gw, gh, blur)

  const alpha = new Uint8ClampedArray(gw * gh)
  for (let idx = 0; idx < alpha.length; idx++) {
    alpha[idx] = Math.round(ratio[idx]! * 255)
  }

  return { width: gw, height: gh, alpha, transform }
}

/**
 * Separable box blur (horizontal pass, then vertical), each pass a 1D
 * sliding-window average built from a prefix sum. Cost is O(pixels)
 * regardless of `radius` — a naive sliding window recomputed from scratch
 * at every cell would cost O(pixels * radius), which stops being cheap once
 * a host asks for a soft, wide blur on a bigger minimap.
 */
function boxBlur(grid: Float64Array, w: number, h: number, radius: number): Float64Array {
  return blur1D(blur1D(grid, w, h, radius, true), w, h, radius, false)
}

function blur1D(
  grid: Float64Array,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
): Float64Array {
  const out = new Float64Array(w * h)
  const outerLen = horizontal ? h : w
  const innerLen = horizontal ? w : h
  const at = (outer: number, inner: number): number => (horizontal ? outer * w + inner : inner * w + outer)
  const prefix = new Float64Array(innerLen + 1)

  for (let outer = 0; outer < outerLen; outer++) {
    for (let inner = 0; inner < innerLen; inner++) {
      prefix[inner + 1] = prefix[inner]! + grid[at(outer, inner)]!
    }
    for (let inner = 0; inner < innerLen; inner++) {
      const lo = Math.max(0, inner - radius)
      const hi = Math.min(innerLen - 1, inner + radius)
      const sum = prefix[hi + 1]! - prefix[lo]!
      out[at(outer, inner)] = sum / (hi - lo + 1)
    }
  }
  return out
}
