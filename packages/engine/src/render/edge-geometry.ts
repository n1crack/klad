import type { EdgeStyle } from './renderer.js'

/**
 * The single source of truth for where a connector attaches.
 *
 * Three places need to agree about this, exactly, and they are in three
 * different files: `canvas2d.ts` draws the path, `svg.ts` writes the same path
 * into an export that is supposed to be indistinguishable from the canvas, and
 * `engine.ts`'s `buildEdgeIndex` builds the bounding box the culler uses to
 * decide whether that path is on screen at all. Any drift between them is a
 * bug you only see at the edges of the viewport, or only in the export — which
 * is to say, a bug you find late. So the anchor maths lives here once and all
 * three call it.
 *
 * Everything in this module works in WORLD units and knows nothing about the
 * camera; each caller applies its own transform afterwards.
 */

/** A connector's two endpoints, parent side then child side. */
export interface EdgeAnchors {
  px: number
  py: number
  cx: number
  cy: number
}

/**
 * Where the folder spine sits, as a fraction of the way from the parent's
 * leading edge to the child's — so `0.5` puts it down the middle of the indent
 * gutter, which is where a file explorer draws it.
 *
 * Deliberately derived from the two boxes rather than from the parent's own
 * width. A file list's rows are usually all the SAME width (they are rows of a
 * list, not cards), so any fraction of the parent's width lands somewhere
 * arbitrary — at a typical row width it overshoots the gutter entirely and
 * puts the spine on top of the child's leading edge, which draws a stub a few
 * pixels long instead of a guide line. The gap between the two leading edges
 * IS the indent, and the indent is exactly the space the line is meant to
 * occupy.
 */
export const FOLDER_SPINE_FRAC = 0.5

/**
 * Anchors for one connector, by style. `(px, py)` is where it leaves the
 * parent and `(cx, cy)` where it enters the child; what happens BETWEEN them
 * is the drawing code's business (an elbow, a spine, a straight line), but
 * both ends are fixed here.
 *
 * `rtl` mirrors the folder spine to the row's right-hand edge, since a
 * right-to-left file list indents the other way.
 */
export function edgeAnchors(
  style: EdgeStyle,
  horizontal: boolean,
  rtl: boolean,
  px0: number,
  py0: number,
  pw: number,
  ph: number,
  cx0: number,
  cy0: number,
  cw: number,
  ch: number,
): EdgeAnchors {
  switch (style) {
    case 'folder': {
      // Down the indent gutter under the parent, then a short tick into the
      // child's leading edge at its vertical centre.
      //
      // The spine's x depends only on the PARENT and its indent, never on
      // which child this edge leads to — every child of the same parent is
      // indented by the same step, so every one of these lines lands on the
      // same vertical. That is what makes a run of siblings read as one guide
      // line down the gutter rather than as a separate bracket per row.
      const parentLead = rtl ? px0 + pw : px0
      const childLead = rtl ? cx0 + cw : cx0
      return {
        px: parentLead + (childLead - parentLead) * FOLDER_SPINE_FRAC,
        py: py0 + ph,
        cx: childLead,
        cy: cy0 + ch / 2,
      }
    }
    case 'spoke':
      // Centre to centre. A radial chart's rings are concentric, so the
      // straight line between two node centres is already radial-ish and
      // never crosses a third ring.
      return { px: px0 + pw / 2, py: py0 + ph / 2, cx: cx0 + cw / 2, cy: cy0 + ch / 2 }
    case 'none':
      // Degenerate but well-defined: a zero-length connector at the parent's
      // centre. Nothing draws it (see `edgeStyleDrawsConnectors`), and a
      // caller that asks anyway gets an empty box rather than NaN.
      return { px: px0 + pw / 2, py: py0 + ph / 2, cx: px0 + pw / 2, cy: py0 + ph / 2 }
    case 'tiered':
    // A curve between the same two points an elbow would join, so the ends
    // agree and only the middle differs.
    case 'bezier':
    default:
      return horizontal
        ? { px: px0 + pw, py: py0 + ph / 2, cx: cx0, cy: cy0 + ch / 2 }
        : { px: px0 + pw / 2, py: py0 + ph, cx: cx0 + cw / 2, cy: cy0 }
  }
}

/**
 * The two control points for a `bezier` connector, given its anchors.
 *
 * Pulled along the GROWTH axis and halfway across the gap, which is what makes
 * the curve leave the parent and enter the child square-on — a curve that left
 * at an angle would read as pointing at a sibling. Both control points stay
 * inside the rectangle the anchors span, so `edgeBBox` bounds this exactly as
 * it bounds an elbow and the culler needs no special case.
 */
export function bezierControls(
  a: EdgeAnchors,
  horizontal: boolean,
): { c1x: number; c1y: number; c2x: number; c2y: number } {
  if (horizontal) {
    const mid = (a.px + a.cx) / 2
    return { c1x: mid, c1y: a.py, c2x: mid, c2y: a.cy }
  }
  const mid = (a.py + a.cy) / 2
  return { c1x: a.px, c1y: mid, c2x: a.cx, c2y: mid }
}

/**
 * The rectangular "more inside" mark, in SCREEN pixels: how far the stub
 * reaches out of the node, and the radius of the dot it ends in. Screen rather
 * than world so the mark is the same size at every zoom — it exists to be
 * noticed from far out, which is exactly where a world-scaled one would be
 * sub-pixel. Shared with `canvas2d.ts` and `svg.ts`, whose drawing has to
 * match, and with the engine, whose reveal starts where this mark ends.
 */
export const HIDDEN_STUB_PX = 9
export const HIDDEN_DOT_PX = 2.5

/**
 * Where a "there is more inside this" mark hangs off a node, for the
 * rectangular layouts — the direction its first connector WOULD leave in, as a
 * unit vector, plus the point it would leave from.
 *
 * Deliberately the connector's own exit rather than some free-floating badge
 * in a corner. The mark means "a branch continues here", and the place a
 * branch continues from is not a matter of opinion: it is wherever the edges
 * to this node's children attach, which is what `edgeAnchors` above already
 * decides. A badge somewhere else would be a second, competing answer to a
 * question the layout has settled.
 *
 * Only ever asked about a RECTANGULAR chart: both callers reach this after
 * ruling out sectors and angles, because a wheel marks its own nodes in its
 * own geometry (an arc inside the segment, a halo around the dot) and a stub
 * poking out of a sector would point at the ring that is already there.
 *
 * That is why `spoke` and `none` answer the same as `tiered` here rather than
 * `null`. Both used to mean "this is a wheel" — `spoke` came only from
 * `radial` and `none` only from `sunburst` — so the question never reached
 * them. Now that `edgeStyle` can be chosen on its own, a tidy chart can ask
 * for either, and it still has a branch continuing downward whether or not a
 * line is drawn to it. Returning `null` there would delete the only thing
 * saying so at a zoom where the cards and their toggles are gone.
 *
 * World units and a unit direction; the caller scales the length, so the mark
 * keeps the same size on screen at any zoom.
 */
export function hiddenStub(
  style: EdgeStyle,
  horizontal: boolean,
  rtl: boolean,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; dx: number; dy: number } | null {
  switch (style) {
    case 'folder':
      // A judgement rather than a geometry problem, and the one style that
      // really does want nothing. A file list is a column of rows with a
      // disclosure control on each one; a stub hanging off the bottom of a row
      // says the same thing the chevron beside its name already does, in a
      // second place, and reads as a stray guide line rather than as a mark.
      return null
    case 'tiered':
    case 'spoke':
    case 'none':
    default:
      return horizontal ? { x: x + w, y: y + h / 2, dx: 1, dy: 0 } : { x: x + w / 2, y: y + h, dx: 0, dy: 1 }
  }
}

/**
 * False for a style that draws nothing, so the engine can skip building an
 * edge index at all rather than building one and having the renderer ignore
 * it. On a sunburst that saves an O(n) pass and an entire quadtree per
 * relayout.
 */
export function edgeStyleDrawsConnectors(style: EdgeStyle): boolean {
  return style !== 'none'
}

/**
 * The axis-aligned box a connector's drawn path stays inside, given its
 * anchors — what the culler indexes.
 *
 * For `tiered` and `spoke` that is exactly the rectangle the two anchors span:
 * an elbow's legs both run along an edge of it, and a straight line is its
 * diagonal. `folder` is the same rectangle, because its spine runs down the
 * parent-side x and its stub across the child-side y, so it too stays within
 * the two anchors' span.
 */
export function edgeBBox(a: EdgeAnchors): { x: number; y: number; w: number; h: number } {
  const x0 = a.px < a.cx ? a.px : a.cx
  const x1 = a.px > a.cx ? a.px : a.cx
  const y0 = a.py < a.cy ? a.py : a.cy
  const y1 = a.py > a.cy ? a.py : a.cy
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
