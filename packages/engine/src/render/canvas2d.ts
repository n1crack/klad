import type { TextMeasurer } from '../text/measure.js'
import type { DrawCallStats, Frame, Renderer, RenderSurface } from './renderer.js'
import type { Theme } from './theme.js'
import { easeInQuad, easeOutCubic } from '../viewport.js'
import { bezierControls, edgeAnchors, hiddenStub } from './edge-geometry.js'
import { computeNodeFills, inkOn } from './palette.js'
import {
  isSectorVisible,
  labelPlacement,
  lineHeightOf,
  normaliseUpright,
  SECTOR_LABEL_PAD,
  sectorPath,
} from './sector.js'

/**
 * The rectangular "more inside" mark, in SCREEN pixels: how far the stub
 * reaches out of the node, and the radius of the dot it ends in. Screen rather
 * than world so the mark is the same size at every zoom — it exists to be
 * noticed from far out, which is exactly where a world-scaled one would be
 * sub-pixel. Shared with `svg.ts`, whose export has to match the canvas.
 */
export const HIDDEN_STUB_PX = 9
export const HIDDEN_DOT_PX = 2.5

/**
 * Canvas2D backend.
 *
 * Camera units are CSS pixels throughout; `dpr` is applied once as a transform
 * on the backing store, so no call site has to remember to multiply.
 *
 * Connectors are accumulated into a single path and stroked once per frame.
 * Stroking per node is the classic way to make a 50k chart unusable, so
 * `stats.lastDrawCalls.edgeStrokes` is asserted by the tests rather than left
 * to trust.
 */
/** Reused so resetting the dash does not allocate an array per frame. */
const EMPTY_DASH: number[] = []

export function createCanvas2DRenderer(
  surface: RenderSurface,
  initialTheme: Theme,
  measurerFor: (font: string) => TextMeasurer,
): Renderer {
  const ctx = surface.getContext('2d')
  if (ctx === null) throw new Error('Klad: 2D canvas context unavailable')

  // Mutable so `setTheme` can swap it in place — every reference to `theme.*`
  // below is a closure over this binding, so reassigning it here is picked up
  // by the very next `draw()` call with no other change needed. The text
  // measurer is deliberately NOT rebuilt on a theme change: `measurerFor` is
  // only ever consulted for `labelFont`, which stays fixed at construction —
  // `setTheme` is documented as paint-only, and font metrics recompute is a
  // relayout-adjacent cost this call is not meant to pay.
  let theme = initialTheme
  const measurer = measurerFor(theme.labelFont)
  let devicePixelRatio = 1

  const stats = { lastDrawCalls: { edgeStrokes: 0, nodes: 0, labels: 0 } as DrawCallStats }

  /**
   * Branch colours, derived from the frame's branch structure and the current
   * theme, and held until either changes.
   *
   * The memo key is the `branchOf` array's IDENTITY plus the theme object's,
   * not their contents: the engine allocates a fresh `branchOf` per relayout
   * and `resolveTheme` a fresh theme per `setTheme`, so identity changes
   * exactly when the answer does. That makes the steady state — the same
   * layout, the same theme, sixty frames a second — a single reference
   * comparison, while a relayout or a theme swap recomputes on the next frame
   * with no explicit invalidation to forget.
   */
  let fillCache: { branchOf: Int32Array; theme: Theme; fills: readonly string[] } | null = null
  const branchFills = (branchOf: Int32Array, branchDepth: Int32Array): readonly string[] => {
    if (fillCache !== null && fillCache.branchOf === branchOf && fillCache.theme === theme) {
      return fillCache.fills
    }
    const fills = computeNodeFills(
      branchOf.length,
      branchOf,
      branchDepth,
      theme.palette,
      theme.paletteOther,
      theme.hubFill,
    )
    fillCache = { branchOf, theme, fills }
    return fills
  }

  /**
   * An elbow is three axis-aligned segments meeting at two bends: `seg0`
   * (leaving the parent) and `seg2` (entering the child) each touch exactly
   * ONE bend, but `segMid` (the crossbar) touches BOTH — so a naive
   * per-corner clamp (`radius <= seg0`, `radius <= seg2`) is not enough on
   * its own: if both bends round INTO `segMid` from opposite ends, the two
   * arcs overshoot and cross exactly when `segMid < 2 * radius`. Halving the
   * `segMid` budget between the two corners (`segMid / 2`) is what prevents
   * that — see `svg.ts`'s `clampEdgeCornerRadius`, which this must match
   * exactly, since the export's whole promise is to look like the canvas.
   */
  function clampEdgeCornerRadius(seg0: number, segMid: number, seg2: number, radius: number): number {
    if (radius <= 0) return 0
    const limit = Math.min(seg0, seg2, segMid / 2)
    return radius < limit ? radius : limit
  }

  const resize = (width: number, height: number, dpr: number): void => {
    devicePixelRatio = dpr
    surface.width = Math.round(width * dpr)
    surface.height = Math.round(height * dpr)
  }

  const draw = (frame: Frame): void => {
    const calls: DrawCallStats = { edgeStrokes: 0, nodes: 0, labels: 0 }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, surface.width, surface.height)
    ctx.save()
    ctx.scale(devicePixelRatio, devicePixelRatio)

    const { boxes, parent, visible, visibleCount, edges, edgeCount, camera } = frame
    const k = camera.k

    // Edges first so nodes paint over the joins. Walks `edges`/`edgeCount`,
    // an INDEPENDENT index from `visible`/`visibleCount` — a connector can
    // cross the viewport while neither of its endpoints' own boxes does (see
    // engine.ts's `buildEdgeIndex`), so the set of connectors to draw is not
    // derivable from the set of visible nodes.
    // World units, scaled by `k` exactly like the node corner radius below —
    // same reasoning: coordinates reaching `ctx` here are already converted
    // to screen space (`world * k + camera.xy`), so a radius traveling
    // alongside them must be scaled the same way to stay proportionate at
    // any zoom. Zeroed at the `block` tier for the same perf reason as the
    // node radius: at extreme zoom-out a 50k chart can have thousands of
    // edges on screen, and the roundRect-vs-rect saving there has a direct
    // analogue here (`quadraticCurveTo` calls vs plain `lineTo`) that isn't
    // worth paying at a zoom level where the rounding is imperceptible.
    const edgeRadius = frame.tier === 'block' ? 0 : theme.edgeCornerRadius * k

    /**
     * Appends one connector's elbow to the CURRENT path. Split out so the
     * edges can be drawn in two passes without the geometry existing twice:
     * ordinary edges in one path, highlighted ones in another. A path can
     * carry only one stroke style, so two colours means two passes — but the
     * elbow maths must stay a single definition, since it also has to keep
     * matching `buildEdgeIndex`'s cull boxes in engine.ts exactly.
     */
    const traceEdge = (i: number, p: number): void => {
      const io = i * 4
      const po = p * 4
      if (frame.edgeStyle !== 'tiered') {
        // Anchors from the shared source (`edge-geometry.ts`), so the drawn
        // path, the engine's cull box and the SVG export cannot disagree about
        // where a connector starts and ends.
        const a = edgeAnchors(
          frame.edgeStyle,
          frame.horizontal,
          frame.rtl,
          boxes[po]!,
          boxes[po + 1]!,
          boxes[po + 2]!,
          boxes[po + 3]!,
          boxes[io]!,
          boxes[io + 1]!,
          boxes[io + 2]!,
          boxes[io + 3]!,
        )
        const px = a.px * k + camera.x
        const py = a.py * k + camera.y
        const cx = a.cx * k + camera.x
        const cy = a.cy * k + camera.y
        ctx.moveTo(px, py)
        if (frame.edgeStyle === 'bezier') {
          // Control points from the shared source, for the same reason the
          // anchors are: the SVG export draws this curve too, and the two
          // have to be the same curve.
          const c = bezierControls(a, frame.horizontal)
          ctx.bezierCurveTo(
            c.c1x * k + camera.x,
            c.c1y * k + camera.y,
            c.c2x * k + camera.x,
            c.c2y * k + camera.y,
            cx,
            cy,
          )
        } else if (frame.edgeStyle === 'spoke') {
          // Centre to centre, straight. On concentric rings that line is
          // already radial, so nothing is gained by bending it.
          ctx.lineTo(cx, cy)
        } else {
          // 'folder': straight down the gutter under the parent, then a short
          // stub into the child's leading edge — the guide line of every file
          // explorer. Deliberately NOT routed around intervening rows: the
          // spine passing behind a sibling's row is what makes a run of
          // children read as one group.
          // One bend, not two, so `clampEdgeCornerRadius`'s crossbar rule
          // doesn't apply: the limit is just the shorter of the two legs
          // meeting at it.
          const r = Math.min(edgeRadius, Math.abs(cy - py), Math.abs(cx - px))
          if (r <= 0) {
            ctx.lineTo(px, cy)
            ctx.lineTo(cx, cy)
          } else {
            const dirDown = cy > py ? 1 : -1
            const dirOut = cx > px ? 1 : -1
            ctx.lineTo(px, cy - dirDown * r)
            ctx.quadraticCurveTo(px, cy, px + dirOut * r, cy)
            ctx.lineTo(cx, cy)
          }
        }
        return
      }
      {
        if (frame.horizontal) {
          // Growth axis is x: leave the parent's right edge, split on x.
          const px = (boxes[po]! + boxes[po + 2]!) * k + camera.x
          const py = (boxes[po + 1]! + boxes[po + 3]! / 2) * k + camera.y
          const cx = boxes[io]! * k + camera.x
          const cy = (boxes[io + 1]! + boxes[io + 3]! / 2) * k + camera.y
          const midX = (px + cx) / 2
          const r =
            edgeRadius > 0
              ? clampEdgeCornerRadius(Math.abs(midX - px), Math.abs(cy - py), Math.abs(cx - midX), edgeRadius)
              : 0
          ctx.moveTo(px, py)
          if (r <= 0) {
            ctx.lineTo(midX, py)
            ctx.lineTo(midX, cy)
            ctx.lineTo(cx, cy)
          } else {
            const dir0 = midX > px ? 1 : -1
            const dirMid = cy > py ? 1 : -1
            const dir2 = cx > midX ? 1 : -1
            ctx.lineTo(midX - dir0 * r, py)
            ctx.quadraticCurveTo(midX, py, midX, py + dirMid * r)
            ctx.lineTo(midX, cy - dirMid * r)
            ctx.quadraticCurveTo(midX, cy, midX + dir2 * r, cy)
            ctx.lineTo(cx, cy)
          }
        } else {
          const px = (boxes[po]! + boxes[po + 2]! / 2) * k + camera.x
          const py = (boxes[po + 1]! + boxes[po + 3]!) * k + camera.y
          const cx = (boxes[io]! + boxes[io + 2]! / 2) * k + camera.x
          const cy = boxes[io + 1]! * k + camera.y
          const midY = (py + cy) / 2
          const r =
            edgeRadius > 0
              ? clampEdgeCornerRadius(Math.abs(midY - py), Math.abs(cx - px), Math.abs(cy - midY), edgeRadius)
              : 0
          ctx.moveTo(px, py)
          if (r <= 0) {
            ctx.lineTo(px, midY)
            ctx.lineTo(cx, midY)
            ctx.lineTo(cx, cy)
          } else {
            const dir0 = midY > py ? 1 : -1
            const dirMid = cx > px ? 1 : -1
            const dir2 = cy > midY ? 1 : -1
            ctx.lineTo(px, midY - dir0 * r)
            ctx.quadraticCurveTo(px, midY, px + dirMid * r, midY)
            ctx.lineTo(cx - dirMid * r, midY)
            ctx.quadraticCurveTo(cx, midY, cx, midY + dir2 * r)
            ctx.lineTo(cx, cy)
          }
        }
      }
    }

    /**
     * An edge counts as highlighted when BOTH of its endpoints are. For the
     * motivating case — "show me the way to this node", where the caller
     * highlights the root-to-node chain — that is exactly the edges along the
     * path and nothing else: consecutive nodes in a path are parent and
     * child, while a highlighted node's other children are not themselves
     * highlighted, so their edges stay ordinary. It also degrades sensibly
     * for any other highlight set (a search result's scattered nodes light up
     * on their own, with no stray connector implying a relationship between
     * them).
     */
    const highlight = frame.highlight
    const edgeLit = (i: number, p: number): boolean =>
      highlight !== null && highlight[i] === 1 && highlight[p] === 1

    if (edgeCount > 0) {
      // Pass 1: everything not on a highlighted path. When nothing is
      // highlighted at all — the whole steady state — the `edgeLit` test is a
      // null check and this is the single pass it always was.
      ctx.beginPath()
      for (let n = 0; n < edgeCount; n++) {
        const i = edges[n]!
        const p = parent[i]!
        if (p === -1 || edgeLit(i, p)) continue
        traceEdge(i, p)
      }
      ctx.strokeStyle = theme.edgeStroke
      ctx.lineWidth = theme.edgeWidth
      ctx.stroke()
      calls.edgeStrokes = 1

      // Pass 2: the highlighted path, drawn after so it lies over the
      // ordinary edges it crosses rather than under them, and thicker, so it
      // reads as a route rather than a recoloured line.
      if (highlight !== null) {
        let anyLit = false
        ctx.beginPath()
        for (let n = 0; n < edgeCount; n++) {
          const i = edges[n]!
          const p = parent[i]!
          if (p === -1 || !edgeLit(i, p)) continue
          traceEdge(i, p)
          anyLit = true
        }
        if (anyLit) {
          ctx.strokeStyle = theme.edgeHighlightStroke
          ctx.lineWidth = theme.edgeHighlightWidth
          ctx.stroke()
          calls.edgeStrokes = 2
        }
      }

      // Pass 3: the flowing ones, last so they lie over everything they
      // cross. The dash offset is worked out from the seconds the engine put
      // on the frame, because this function reads no clock.
      //
      // Dropped entirely at the `block` tier, the same rule and the same
      // reason as the elbow radius above: zoomed out that far a connector is
      // a couple of pixels and the dash is not visible, while dashed
      // stroking costs the rasteriser real work per segment — on a 50k chart
      // that is thousands of edges paying for something nobody can see.
      // They fall into pass 1 and are drawn as ordinary lines, and the
      // caller stops asking for frames (see `Options.edgeFlow`), so a chart
      // zoomed out goes still instead of burning a battery on invisible
      // dashes.
      //
      // `!= null` rather than `!== null`: a frame assembled by hand that
      // leaves the field off should draw an ordinary chart, not take the
      // whole render down on the first edge.
      const flow = frame.tier === 'block' ? null : frame.edgeFlow
      if (flow != null) {
        let anyFlow = false
        ctx.beginPath()
        for (let n = 0; n < edgeCount; n++) {
          const i = edges[n]!
          const p = parent[i]!
          if (p === -1 || flow[i] !== 1) continue
          traceEdge(i, p)
          anyFlow = true
        }
        if (anyFlow) {
          // The whole pattern, not just the first two: a dash array can have
          // any number of segments and repeats over their total.
          let total = 0
          for (const segment of theme.edgeFlowDash) total += segment
          const period = total > 0 ? total : 1
          ctx.setLineDash(theme.edgeFlowDash)
          // Wrapped to one period, so the number stays small however long the
          // page has been open — an offset growing without bound loses
          // precision, and a dash that drifts out of step after an hour is a
          // bug nobody would think to look for. Negative so the dashes travel
          // from parent to child rather than back up the tree.
          ctx.lineDashOffset = -((frame.edgeFlowSeconds * theme.edgeFlowSpeed) % period)
          ctx.strokeStyle = theme.edgeFlowStroke
          ctx.lineWidth = theme.edgeFlowWidth
          ctx.stroke()
          // Put it back: the dash is a property of the CONTEXT, and a node
          // outline drawn after this would come out dashed too.
          ctx.setLineDash(EMPTY_DASH)
          ctx.lineDashOffset = 0
          calls.edgeStrokes += 1
        }
      }
    }

    const radius = frame.tier === 'block' ? 0 : theme.cornerRadius * k

    // Nodes a collapse is still removing, drawn before the surviving nodes
    // so a settled ancestor paints crisply over whatever is shrinking into
    // it. No label or highlight/drag handling — a ghost is gone from the
    // pruned tree and neither concept applies to it — but it IS stroked,
    // same as a real node at this tier, so the brief window it's visible
    // (see engine.ts's `ghostFadeRaw`, front-loaded specifically so this
    // window is brief) reads as "a card shrinking away" rather than a blank
    // filled rectangle. Stroking costs one extra `ctx.stroke()` per ghost,
    // same as a real node, and ghosts are already bounded to those near the
    // viewport, so this stays within the per-frame budget.
    // `block`-tier fill: a SEPARATE, independently adjustable colour from
    // `nodeFill` (see `theme.blockFill`'s docblock), defaulting to
    // `'transparent'` so the far-zoom shape-only tier shows the connector
    // skeleton without solid boxes by default. The exact string
    // `'transparent'` is treated as "skip the fill call" rather than "fill
    // with a colour that happens to be invisible" — a real `ctx.fill()` per
    // on-screen node at the tier busiest with nodes on screen at once is
    // exactly the kind of per-node cost the 50k budget can't absorb for a
    // no-op paint.
    const blockFillSkipped = frame.tier === 'block' && theme.blockFill === 'transparent'
    const unlitFill = frame.tier === 'block' ? theme.blockFill : theme.nodeFill

    // Per-node branch colour, where the layout asked for one. Still loses to
    // highlight and selection: those mean "the chart is answering you", and an
    // ambient branch colour must not drown out an answer.
    const fills =
      frame.branchOf !== null && frame.branchDepth !== null && frame.tier !== 'block'
        ? branchFills(frame.branchOf, frame.branchDepth)
        : null
    const fillFor = (i: number): string => (fills !== null ? (fills[i] ?? unlitFill) : unlitFill)

    const sectors = frame.sectors
    /**
     * Traces node `i` into the current path, as a sector on a wheel or a
     * (rounded) rectangle everywhere else. One function so the fill, the
     * stroke and the selection outline below can't disagree about the shape
     * they are painting.
     *
     * Returns false for a sector with no extent — the collapsed out-of-focus
     * and beyond-the-last-ring nodes a sunburst layout deliberately keeps in
     * the tree so they have somewhere to animate from. They cull in (their
     * bounding box is a degenerate point at a real position) but there is
     * nothing to draw, and asking the canvas to fill a zero-area path per node
     * is a cost with no pixels to show for it.
     */
    const traceNode = (i: number): boolean => {
      if (sectors !== null) {
        const s = i * 6
        const r0 = sectors[s + 2]! * k
        const r1 = sectors[s + 3]! * k
        const a0 = sectors[s + 4]!
        const a1 = sectors[s + 5]!
        if (!isSectorVisible(r0, r1, a0, a1)) return false
        sectorPath(ctx, sectors[s]! * k + camera.x, sectors[s + 1]! * k + camera.y, r0, r1, a0, a1)
        return true
      }
      const o = i * 4
      const x = boxes[o]! * k + camera.x
      const y = boxes[o + 1]! * k + camera.y
      const w = boxes[o + 2]! * k
      const h = boxes[o + 3]! * k
      if (radius > 0) ctx.roundRect(x, y, w, h, radius)
      else ctx.rect(x, y, w, h)
      return true
    }

    // A ghost is a rectangle by construction — it is a box tween, and the
    // engine has no sector to hand it once the node has left the tree. On a
    // wheel that would be a rectangle flying across the disc, which reads as a
    // rendering fault rather than as a node leaving; the sectors re-partition
    // to fill the space anyway, so the collapse is already legible without one.
    if (frame.ghostCount > 0 && sectors === null) {
      for (let g = 0; g < frame.ghostCount; g++) {
        if (blockFillSkipped) {
          // Nothing to fill and (at this tier) nothing to stroke either — a
          // ghost has no highlight/drag state to paint some other colour
          // for, so there is genuinely nothing left to draw here.
          calls.nodes++
          continue
        }
        const o = g * 4
        const x = frame.ghostBoxes[o]! * k + camera.x
        const y = frame.ghostBoxes[o + 1]! * k + camera.y
        const w = frame.ghostBoxes[o + 2]! * k
        const h = frame.ghostBoxes[o + 3]! * k
        ctx.globalAlpha = frame.ghostAlpha[g]!
        ctx.beginPath()
        if (radius > 0) ctx.roundRect(x, y, w, h, radius)
        else ctx.rect(x, y, w, h)
        ctx.fillStyle = unlitFill
        ctx.fill()
        if (frame.tier !== 'block') {
          ctx.strokeStyle = theme.nodeStroke
          ctx.lineWidth = theme.nodeStrokeWidth
          ctx.stroke()
        }
        calls.nodes++
      }
      ctx.globalAlpha = 1
    }

    for (let n = 0; n < visibleCount; n++) {
      const i = visible[n]!
      const lit = frame.highlight !== null && frame.highlight[i] === 1
      // Nodes newly revealed by an in-progress expand fade in; `revealAlpha`
      // is null whenever no transition is affecting opacity this frame, so
      // the common case never touches `globalAlpha` for this reason at all.
      const revealAlpha = frame.revealAlpha !== null ? frame.revealAlpha[n]! : 1

      if (i === frame.dragIndex) ctx.globalAlpha = theme.dragGhostAlpha
      else if (revealAlpha < 1) ctx.globalAlpha = revealAlpha

      // A highlighted node stays visible regardless of `blockFill` — the
      // highlight is a deliberate, explicit signal (search/focus), not the
      // ambient node colour the block tier's default transparency is about
      // hiding — so only an UNLIT node at the block tier can be skipped.
      const isSelected = frame.selected !== null && frame.selected[i] === 1
      // Same reasoning as `lit` below: a node the viewer explicitly selected
      // is not ambient colour, so the block tier's transparency does not
      // apply to it.
      if (!lit && !isSelected && blockFillSkipped) {
        calls.nodes++
        if (i === frame.dragIndex || revealAlpha < 1) ctx.globalAlpha = 1
        continue
      }

      ctx.beginPath()
      if (!traceNode(i)) {
        calls.nodes++
        if (i === frame.dragIndex || revealAlpha < 1) ctx.globalAlpha = 1
        continue
      }
      ctx.fillStyle = lit ? theme.highlightFill : fillFor(i)
      ctx.fill()
      if (frame.tier !== 'block') {
        if (sectors !== null) {
          // The separation between neighbouring sectors is a hairline in the
          // SURFACE colour, not a border: a sunburst's sectors tile the disc
          // edge to edge, so what a viewer should see between two of them is
          // the page showing through, the way it does between two bars. A
          // `nodeStroke`-coloured outline instead reads as a drawn frame
          // around every segment, which at three rings deep is more ink than
          // data. Skipped entirely at `sectorGap: 0`, for a host that wants
          // one continuous disc.
          if (theme.sectorGap > 0) {
            ctx.strokeStyle = lit ? theme.highlightStroke : theme.surface
            ctx.lineWidth = theme.sectorGap
            ctx.stroke()
          }
        } else {
          ctx.strokeStyle = lit ? theme.highlightStroke : theme.nodeStroke
          ctx.lineWidth = theme.nodeStrokeWidth
          ctx.stroke()
        }
      }
      // The selection outline goes OVER whatever the node's own stroke was,
      // rather than replacing it: a selected node is still a highlighted node
      // or a plain one, and losing that says the wrong thing. Drawn at every
      // tier, `block` included — a selection made at a readable zoom has to
      // still be findable after zooming out, which is exactly when it matters.
      if (isSelected) {
        // Re-traced rather than reusing the path above: the sector gap stroke
        // may already have been applied to it, and a second `stroke()` on the
        // same path would lay the selection outline over a hairline that has
        // eaten into the shape's edge. On the rectangular path this is the
        // same geometry either way.
        if (sectors !== null) {
          ctx.beginPath()
          traceNode(i)
        }
        ctx.strokeStyle = theme.selectionStroke
        ctx.lineWidth = theme.selectionStrokeWidth
        ctx.stroke()
      }
      calls.nodes++

      if (i === frame.dragIndex || revealAlpha < 1) ctx.globalAlpha = 1
    }

    // "There is more inside this." Drawn between the nodes and the labels, so
    // it sits over its own node and under the text — see `Frame.hasHidden` for
    // why the wheel layouts need a mark at all.
    //
    // Skipped at the `block` tier along with the labels: at a zoom where a node
    // is a few pixels of colour, a mark on it is a few pixels of noise.
    const hidden = frame.hasHidden
    if (hidden !== null && frame.tier !== 'block') {
      ctx.lineWidth = 1.5
      for (let n = 0; n < visibleCount; n++) {
        const i = visible[n]!
        if (hidden[i] !== 1) continue
        if (sectors !== null) {
          // A second arc just inside the segment's outer edge, in its own
          // label ink: it reads as the beginning of the ring that would be
          // there if the branch were open. Drawn inside rather than outside
          // because outside is where the NEXT ring lives, and a mark there
          // would be a promise about space that is already spoken for.
          const s = i * 6
          const r1 = sectors[s + 3]! * k
          const r0 = sectors[s + 2]! * k
          const inset = Math.min(4, (r1 - r0) * 0.28)
          if (inset < 1.5) continue
          ctx.beginPath()
          ctx.arc(
            sectors[s]! * k + camera.x,
            sectors[s + 1]! * k + camera.y,
            r1 - inset,
            sectors[s + 4]!,
            sectors[s + 5]!,
            false,
          )
          ctx.strokeStyle = inkOn(fillFor(i), theme.labelColour, theme.labelColourInverse)
          ctx.globalAlpha = 0.55
          ctx.stroke()
          ctx.globalAlpha = 1
        } else if (frame.angles !== null) {
          // A halo around the marker — the same "there is a ring here you
          // cannot see" idea, at the scale of a dot.
          const o = i * 4
          const w = boxes[o + 2]! * k
          const h = boxes[o + 3]! * k
          ctx.beginPath()
          ctx.arc(
            (boxes[o]! + boxes[o + 2]! / 2) * k + camera.x,
            (boxes[o + 1]! + boxes[o + 3]! / 2) * k + camera.y,
            Math.max(w, h) / 2 + 3,
            0,
            Math.PI * 2,
            false,
          )
          ctx.strokeStyle = fills !== null ? fillFor(i) : theme.labelColour
          ctx.globalAlpha = 0.5
          ctx.stroke()
          ctx.globalAlpha = 1
        } else {
          // Rectangular layouts: a short stub leaving the node the way its
          // first connector would, ending in a dot. Same idea as the wheel's
          // inner arc — the beginning of the branch that is there but not
          // drawn — and it is the ONLY thing on a tidy or file chart that says
          // so at a zoom where the cards are gone and there is no toggle
          // button to notice.
          const stub = hiddenStub(
            frame.edgeStyle,
            frame.horizontal,
            frame.rtl,
            boxes[i * 4]!,
            boxes[i * 4 + 1]!,
            boxes[i * 4 + 2]!,
            boxes[i * 4 + 3]!,
          )
          if (stub === null) continue
          // Screen-space length, so the mark stays the same size however far
          // out the camera is — a world-length stub would vanish at the zoom
          // where it matters most.
          const sx = stub.x * k + camera.x
          const sy = stub.y * k + camera.y
          const ex = sx + stub.dx * HIDDEN_STUB_PX
          const ey = sy + stub.dy * HIDDEN_STUB_PX
          ctx.strokeStyle = theme.edgeStroke
          ctx.globalAlpha = 0.75
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(ex, ey)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(ex, ey, HIDDEN_DOT_PX, 0, Math.PI * 2, false)
          ctx.fillStyle = theme.edgeStroke
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }
    }

    if (frame.tier !== 'block' && frame.labels.length > 0) {
      ctx.fillStyle = theme.labelColour
      ctx.font = theme.labelFont
      ctx.textBaseline = 'middle'
      const pad = theme.labelPadding * k

      if (sectors !== null) {
        // --- Sunburst: text laid on the sector itself.
        //
        // This is what makes a wheel readable rather than decorative, and it
        // is also the relief the palette's contrast notes require: several of
        // the categorical hues sit under 3:1 against a light page, and a
        // visible label on the mark is what discharges that. Two consequences
        // follow, both handled here — the ink is chosen per sector against the
        // fill actually behind it, and a sector too small to hold text simply
        // goes unlabelled rather than being given a clipped one.
        const lineHeight = lineHeightOf(theme.labelFont)
        ctx.textAlign = 'center'
        for (let n = 0; n < visibleCount; n++) {
          const i = visible[n]!
          const label = frame.labels[i]
          if (label === undefined || label === '') continue
          const s = i * 6
          const place = labelPlacement(
            sectors[s + 2]! * k,
            sectors[s + 3]! * k,
            sectors[s + 4]!,
            sectors[s + 5]!,
            lineHeight,
          )
          if (place === null) continue
          const text = measurer.truncate(label, place.maxWidth)
          if (text === '') continue
          const revealAlpha = frame.revealAlpha !== null ? frame.revealAlpha[n]! : 1
          ctx.save()
          if (revealAlpha < 1) ctx.globalAlpha = revealAlpha
          ctx.translate(sectors[s]! * k + camera.x + place.x, sectors[s + 1]! * k + camera.y + place.y)
          if (place.angle !== 0) ctx.rotate(place.angle)
          ctx.fillStyle =
            frame.highlight !== null && frame.highlight[i] === 1
              ? theme.labelColour
              : inkOn(fillFor(i), theme.labelColour, theme.labelColourInverse)
          ctx.fillText(text, 0, 0)
          ctx.restore()
          calls.labels++
        }
        ctx.textAlign = 'left'
      } else if (frame.angles !== null) {
        // --- Radial: the card stays axis-aligned, the NAME radiates.
        //
        // Laid just outside the card along its own ray and turned to follow
        // it, flipping on the left-hand side of the wheel so nothing reads
        // upside down. This is the difference between a radial chart whose
        // outer ring is a crowd of overlapping horizontal labels and one you
        // can actually read: at a constant angular spacing, tangentially
        // crowded text has room to run outward instead.
        const angles = frame.angles
        // Screen-space room for one radiating name: what the layout reserved
        // outside the outermost ring, minus the marker's own half-width the
        // text starts after.
        const radialRoom = frame.labelSpace * k
        ctx.textAlign = 'left'
        for (let n = 0; n < visibleCount; n++) {
          const i = visible[n]!
          const label = frame.labels[i]
          if (label === undefined || label === '') continue
          const o = i * 4
          const w = boxes[o + 2]! * k
          const h = boxes[o + 3]! * k
          const cx = (boxes[o]! + boxes[o + 2]! / 2) * k + camera.x
          const cy = (boxes[o + 1]! + boxes[o + 3]! / 2) * k + camera.y
          // Room to run outward: whatever the label allowance the layout
          // reserved outside the last ring is, in screen units. Bounded by the
          // card's own width as a proxy, which is exactly what `radial`'s
          // bounds reserved for it.
          const angle = angles[i]!
          const revealAlpha = frame.revealAlpha !== null ? frame.revealAlpha[n]! : 1
          // No ray — the node is ON the centre (see `radial`'s `NaN`). Its
          // name goes horizontally through the middle of it, like the label
          // in the hole of a donut chart.
          if (Number.isNaN(angle)) {
            // The hub's name runs across the middle. Truncated, unlike the
            // radiating ones below: this one DOES have something to collide
            // with — the innermost ring, all the way around it.
            const text = measurer.truncate(label, Math.max(0, w + radialRoom))
            if (text === '') continue
            ctx.save()
            if (revealAlpha < 1) ctx.globalAlpha = revealAlpha
            ctx.textAlign = 'center'
            ctx.fillText(text, cx, cy)
            ctx.restore()
            calls.labels++
            continue
          }
          const offsetFromCentre = Math.max(w, h) / 2 + SECTOR_LABEL_PAD
          // NOT truncated, deliberately — the one label in this renderer that
          // isn't.
          //
          // Every other label sits inside a box, so overflowing it is a
          // visible defect and cutting the text is the lesser harm. A
          // radiating name has no box: it points outward into open space, and
          // consecutive names on a ring fan APART as they go, so there is
          // nothing for it to overlap. What it could be cut against is the
          // layout's world-unit reserve — but labels are drawn at a fixed
          // screen size while that reserve shrinks with the zoom, so bounding
          // by it means every name on the chart collapses to an ellipsis the
          // moment a viewer zooms out far enough to see the whole wheel. Which
          // is the default view. And a radial node is usually a bare marker
          // (see the layout's docblock), so its name is the ONLY thing it
          // carries: "Person …" is not a shortened label, it is a blank one.
          //
          // A host that wants shorter names supplies them through `label`.
          const upright = normaliseUpright(angle)
          const flipped = upright !== angle
          ctx.save()
          if (revealAlpha < 1) ctx.globalAlpha = revealAlpha
          ctx.translate(cx, cy)
          ctx.rotate(upright)
          // The marker's own half-width clears it before the text starts; a
          // flipped label runs the other way, so it is right-aligned at the
          // mirrored offset instead.
          ctx.textAlign = flipped ? 'right' : 'left'
          ctx.fillText(label, flipped ? -offsetFromCentre : offsetFromCentre, 0)
          ctx.restore()
          calls.labels++
        }
        ctx.textAlign = 'left'
      } else {
        for (let n = 0; n < visibleCount; n++) {
          const i = visible[n]!
          const label = frame.labels[i]
          if (label === undefined || label === '') continue
          const o = i * 4
          const w = boxes[o + 2]! * k
          const text = measurer.truncate(label, Math.max(0, w - pad * 2))
          if (text === '') continue
          const revealAlpha = frame.revealAlpha !== null ? frame.revealAlpha[n]! : 1
          if (revealAlpha < 1) ctx.globalAlpha = revealAlpha
          ctx.fillText(
            text,
            boxes[o]! * k + camera.x + pad,
            (boxes[o + 1]! + boxes[o + 3]! / 2) * k + camera.y,
          )
          if (revealAlpha < 1) ctx.globalAlpha = 1
          calls.labels++
        }
      }
    }

    // The drop preview, drawn over the nodes and their labels: it is the most
    // important thing on screen for as long as it is there, and a drag is
    // exactly when a viewer is looking for it rather than at the data.
    //
    // A preview of the RESULT, not a hover state. `into` outlines the target;
    // `before`/`after` draw a line along the edge the node would arrive at.
    // Lighting up whatever is under the pointer would leave the three modes
    // indistinguishable, and the edge bands exist precisely because they mean
    // different things.
    if (frame.dropIndex !== -1) {
      const i = frame.dropIndex
      ctx.strokeStyle = frame.dropValid ? theme.dropStroke : theme.dropRefusedStroke
      ctx.lineWidth = theme.dropStrokeWidth
      if (frame.dropMode === 'into') {
        ctx.beginPath()
        if (traceNode(i)) ctx.stroke()
      } else {
        // The insertion line runs ACROSS the axis siblings are laid out along
        // — the same axis the edge bands were measured on, so the line appears
        // exactly where the pointer said. On a wheel `dropMode` is always
        // `into`, so this branch is never a question of angles.
        const o = i * 4
        const x = boxes[o]! * k + camera.x
        const y = boxes[o + 1]! * k + camera.y
        const w = boxes[o + 2]! * k
        const h = boxes[o + 3]! * k
        const along = frame.edgeStyle === 'folder' || frame.horizontal ? 'y' : 'x'
        const after = frame.dropMode === 'after'
        ctx.beginPath()
        if (along === 'y') {
          const lineY = after ? y + h : y
          ctx.moveTo(x, lineY)
          ctx.lineTo(x + w, lineY)
        } else {
          const lineX = after ? x + w : x
          ctx.moveTo(lineX, y)
          ctx.lineTo(lineX, y + h)
        }
        ctx.stroke()
      }
    }

    // One-shot expand/collapse confirmation ring, drawn last so it isn't
    // occluded by a neighbouring node or its own label. A single stroked
    // path regardless of tree size — at most one ring is ever live (see
    // engine.ts's `setOpen`), so this never threatens the frame budget.
    //
    // Growth and fade are deliberately driven by TWO DIFFERENT curves, not
    // one shared between them:
    //  - `easeOutCubic` (fast-start, slow-finish) for the outward `grow`:
    //    the ring reaches most of its final size almost immediately, which
    //    reads as a snappy "pop" reacting to the click.
    //  - `easeInQuad` (slow-start, fast-finish), INVERTED, for `alpha`: the
    //    ring stays clearly visible through roughly the first half of its
    //    life and only falls away in the back half.
    // Using `easeOutCubic` for BOTH (i.e. `alpha = 1 - easeOutCubic(progress)`)
    // was tried and rejected: that curve reaches ~0.87 by `progress = 0.5`, so
    // `1 -` that is already down to ~0.13 alpha at the HALFWAY point — the
    // ring would be all but gone before `grow` had even finished expanding
    // it, which reads as a flicker, not a soft fade. With the curves as
    // written here, the ring is still near-fully grown AND still clearly
    // visible together through the middle of the flash, and only fades away
    // once it has already settled at its final size — see `easeInQuad`'s
    // docblock in viewport.ts for the exact numbers.
    //
    // `theme.ringMaxOffset`/`ringStrokeWidth` are screen pixels applied
    // directly here, in already-screen-space coordinates (`* k + camera.xy`
    // has already happened) — see their docblocks in theme.ts for why this
    // renderer needs no further division by `k` the way a world-space,
    // ctx-transform-scaled pipeline would.
    if (frame.ringActive) {
      const progress = frame.ringProgress
      const grow = theme.ringMaxOffset * easeOutCubic(progress)
      const rb = frame.ringBox
      const x = rb[0]! * k + camera.x
      const y = rb[1]! * k + camera.y
      const w = rb[2]! * k
      const h = rb[3]! * k
      const ringRadius = (frame.tier === 'block' ? 0 : theme.cornerRadius * k) + grow
      // Hold at full opacity for the first third, then fade across the rest.
      // A curve that starts fading from t=0 spends most of the ring's life
      // nearly transparent, which is why the first version read as a flicker
      // however long it ran: the duration was there, the visibility was not.
      const RING_HOLD = 0.35
      ctx.globalAlpha =
        progress <= RING_HOLD ? 1 : 1 - easeInQuad((progress - RING_HOLD) / (1 - RING_HOLD))
      ctx.beginPath()
      if (ringRadius > 0) ctx.roundRect(x - grow, y - grow, w + grow * 2, h + grow * 2, ringRadius)
      else ctx.rect(x - grow, y - grow, w + grow * 2, h + grow * 2)
      ctx.strokeStyle = theme.ringStroke
      ctx.lineWidth = theme.ringStrokeWidth
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    ctx.restore()
    stats.lastDrawCalls = calls
  }

  const setTheme = (next: Theme): void => {
    theme = next
  }

  return {
    resize,
    draw,
    setTheme,
    get stats() {
      return stats
    },
  }
}
