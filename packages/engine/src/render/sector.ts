import type { RenderContext2D } from './renderer.js'

/**
 * Drawing and label-placement maths for annular sectors — the sunburst's
 * nodes.
 *
 * Split out of `canvas2d.ts` for the same reason `edge-geometry.ts` was: the
 * SVG export has to produce a picture indistinguishable from the canvas, and
 * "indistinguishable" does not survive two independent implementations of
 * where a label goes. The canvas backend calls the tracer with a canvas
 * context; `svg.ts` calls the same placement functions and emits path data.
 *
 * Everything here works in whatever units the caller passes. Both callers pass
 * SCREEN pixels — radii already multiplied by the camera's zoom — because label
 * text is drawn at a fixed size regardless of zoom, so the decision "does this
 * label fit" is only meaningful once the geometry is in the same units the text
 * is.
 */

const TAU = Math.PI * 2

/** Breathing room between a label and the edges of the sector holding it, in
 * screen pixels. */
export const SECTOR_LABEL_PAD = 4

/**
 * Angular width below which a sector counts as closed rather than merely thin.
 *
 * Not a fudge: `sunburst`'s focus maps the focused node's wedge onto the whole
 * turn by multiplying by `TAU / focusSpan`, and `focusSpan * (TAU / focusSpan)`
 * is not exactly `TAU` in floating point. So the focused node's upper edge
 * lands an ulp short of the seam, and the sibling immediately after it — which
 * should clamp to zero width — keeps a wedge of about 1e-15 radians instead.
 *
 * That sliver is invisible as a FILL and very visible as everything else: it
 * still takes the sector-gap stroke, drawing a hairline spoke from the centre
 * out; and because its inner radius is zero, a naive reading of its geometry
 * calls it a disc and writes its label across the middle of the hub, on top of
 * the label that belongs there.
 *
 * 1e-9 radians is around a thousandth of a pixel at a radius of a million, so
 * nothing this rejects could have been drawn anyway.
 */
export const MIN_SECTOR_ANGLE = 1e-9

/**
 * Whether a sector has anything to draw. The single definition of "collapsed",
 * shared by the engine's cull, both renderers and the label placement below —
 * a sector that one of them thinks is closed and another thinks is open is
 * exactly how a sliver ends up stroked but not filled.
 */
export function isSectorVisible(r0: number, r1: number, a0: number, a1: number): boolean {
  return r1 - r0 > 0 && a1 - a0 > MIN_SECTOR_ANGLE
}

/**
 * Approximate line height for a CSS font shorthand, by reading the px size out
 * of it. Used only to decide whether a sector is thick enough to hold text at
 * all, so an approximation is the right tool — the alternative is asking the
 * canvas for font metrics, which is a per-frame measurement to answer a
 * question that only needs a threshold. Falls back to 14px for a font string
 * with no px size (`1em`, a keyword), which is the default theme's size.
 */
export function lineHeightOf(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font)
  const px = match === null ? 14 : Number.parseFloat(match[1]!)
  // Cap-height plus a little, rather than the full line box: a label is
  // vertically centred in its sector, and the descender space below it is not
  // something the sector has to be thick enough to contain.
  return px * 1.15
}

/**
 * Turns `angle` the right way up. Text rotated into the lower half of the
 * circle reads upside down; adding half a turn puts it back the right way
 * without moving where it sits, because the label is centred on its anchor
 * point in both axes.
 */
export function normaliseUpright(angle: number): number {
  let a = angle % TAU
  if (a < 0) a += TAU
  return a > Math.PI / 2 && a < (3 * Math.PI) / 2 ? angle + Math.PI : angle
}

/**
 * Traces one annular sector into `ctx`'s current path. Does not begin, fill or
 * stroke it — the caller controls that, so several sectors can share one path
 * where the paint is the same.
 *
 * Three shapes, because a sunburst genuinely contains all three: a full disc
 * (the hub, `r0 === 0` spanning the whole turn), a full ring (a single-child
 * generation), and the ordinary wedge.
 */
export function sectorPath(
  ctx: RenderContext2D,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): void {
  const full = a1 - a0 >= TAU - 1e-9
  if (full) {
    ctx.moveTo(cx + r1, cy)
    ctx.arc(cx, cy, r1, 0, TAU, false)
    if (r0 > 0) {
      // Second subpath, wound the other way, so the even-odd/nonzero fill
      // leaves a hole rather than painting straight over it.
      ctx.moveTo(cx + r0, cy)
      ctx.arc(cx, cy, r0, TAU, 0, true)
    }
    ctx.closePath()
    return
  }
  if (r0 <= 0) {
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0))
    ctx.arc(cx, cy, r1, a0, a1, false)
    ctx.closePath()
    return
  }
  ctx.moveTo(cx + r0 * Math.cos(a0), cy + r0 * Math.sin(a0))
  ctx.lineTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0))
  ctx.arc(cx, cy, r1, a0, a1, false)
  ctx.lineTo(cx + r0 * Math.cos(a1), cy + r0 * Math.sin(a1))
  ctx.arc(cx, cy, r0, a1, a0, true)
  ctx.closePath()
}

/** Where a sector's label goes, and how much room it has. */
export interface LabelPlacement {
  /** Offset from the wheel's centre, in the caller's units. */
  x: number
  y: number
  /** Rotation in radians, already turned the right way up. */
  angle: number
  /** Room available along the text's own baseline, padding already deducted. */
  maxWidth: number
}

/**
 * Where to put the label for the sector `[r0, r1] x [a0, a1]`, or `null` when
 * the sector cannot hold readable text and the label should simply be skipped.
 *
 * Skipping is the important half. A sunburst of any size has far more sectors
 * than labels that will fit in them, and the failure mode of trying anyway is
 * the one that makes these charts look amateurish: text spilling across ring
 * boundaries, overlapping its neighbours, or clipped mid-word. A label is drawn
 * only where it genuinely fits, and the rest of the tree is reachable by
 * hovering or by drilling in.
 *
 * Two orientations, picked by which way the sector is longer:
 *
 *  - **Tangential** — text running around the ring — for a sector wider than it
 *    is thick, which is most of them on the inner rings.
 *  - **Radial** — text running outward along the ray — for a tall, narrow
 *    sector, which is what the outer rings are made of.
 *
 * In both cases the text is a STRAIGHT line, not warped along the arc, so the
 * room available is bounded by geometry rather than by arc length: a straight
 * chord drawn at mid-radius leaves the sector at its ends long before it has
 * used up the arc above it. Both bounds below are that containment condition
 * solved for the text's half-length, which is why a wide sector does not get
 * credit for the full sweep of its arc.
 */
export function labelPlacement(
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  lineHeight: number,
): LabelPlacement | null {
  const thickness = r1 - r0
  if (thickness < lineHeight) return null

  const span = a1 - a0
  if (!isSectorVisible(r0, r1, a0, a1)) return null
  const mid = (a0 + a1) / 2

  // The hub: a FULL disc, labelled horizontally across its middle like the
  // centre of a donut chart, because it has no ring direction to follow.
  //
  // The full-turn test is not decoration. A wedge that merely starts at the
  // centre is a pie slice, not a hub, and reading `r0 <= 0` alone as "this is
  // the middle" writes its label across the middle of the wheel — where it
  // lands on top of whatever actually belongs there. A near-zero sliver at the
  // seam is exactly such a wedge; see `MIN_SECTOR_ANGLE`.
  if (r0 <= 0 && span >= TAU - 1e-9) {
    const maxWidth = 2 * r1 - 2 * SECTOR_LABEL_PAD
    return maxWidth <= 0 ? null : { x: 0, y: 0, angle: 0, maxWidth }
  }

  const rMid = (r0 + r1) / 2
  const half = Math.min(span, Math.PI * 0.999) / 2

  // Tangential half-length is bounded twice over: by the outer arc (the chord
  // must not poke past r1) and by the sector's own sides (its ends must stay
  // inside the wedge).
  const byOuter = Math.sqrt(Math.max(0, r1 * r1 - rMid * rMid))
  const bySides = rMid * Math.tan(half)
  const tangentialRoom = 2 * Math.min(byOuter, bySides)
  // Radial text runs along the ray; its cross-dimension has to clear the
  // narrowest part of the wedge, which is the chord at the INNER radius.
  const radialCross = 2 * r0 * Math.sin(half)

  if (tangentialRoom >= thickness) {
    const maxWidth = tangentialRoom - 2 * SECTOR_LABEL_PAD
    if (maxWidth <= 0) return null
    return {
      x: rMid * Math.cos(mid),
      y: rMid * Math.sin(mid),
      angle: normaliseUpright(mid + Math.PI / 2),
      maxWidth,
    }
  }

  if (radialCross < lineHeight) return null
  const maxWidth = thickness - 2 * SECTOR_LABEL_PAD
  if (maxWidth <= 0) return null
  return {
    x: rMid * Math.cos(mid),
    y: rMid * Math.sin(mid),
    angle: normaliseUpright(mid),
    maxWidth,
  }
}
