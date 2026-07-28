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
    default:
      return horizontal
        ? { px: px0 + pw, py: py0 + ph / 2, cx: cx0, cy: cy0 + ch / 2 }
        : { px: px0 + pw / 2, py: py0 + ph, cx: cx0 + cw / 2, cy: cy0 }
  }
}

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
 * `null` for the polar styles, which have their own mark drawn in their own
 * geometry (an arc inside the segment, a halo around the dot) — a stub poking
 * out of a sector would point at the ring that is already there.
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
      // Straight down, out of the bottom of the row, where the gutter spine
      // starts. Not offset into the gutter by `FOLDER_SPINE_FRAC`: that
      // fraction is derived from the CHILD's leading edge, and there is no
      // child here to derive it from — which is the whole point of the mark.
      return { x: rtl ? x + w : x, y: y + h, dx: 0, dy: 1 }
    case 'tiered':
      return horizontal
        ? { x: x + w, y: y + h / 2, dx: 1, dy: 0 }
        : { x: x + w / 2, y: y + h, dx: 0, dy: 1 }
    default:
      // `spoke` and `none`: a radial chart marks its own nodes with a halo and
      // a sunburst with an inner arc, and a chart with no connectors at all
      // has nothing for a stub to be the beginning of.
      return null
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
