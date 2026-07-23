import type { TextMeasurer } from '../text/measure.js'
import type { DrawCallStats, Frame, Renderer, RenderSurface } from './renderer.js'
import type { Theme } from './theme.js'
import { easeInQuad, easeOutCubic } from '../viewport.js'

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

    if (frame.ghostCount > 0) {
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
      const o = i * 4
      const x = boxes[o]! * k + camera.x
      const y = boxes[o + 1]! * k + camera.y
      const w = boxes[o + 2]! * k
      const h = boxes[o + 3]! * k
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
      if (!lit && blockFillSkipped) {
        calls.nodes++
        if (i === frame.dragIndex || revealAlpha < 1) ctx.globalAlpha = 1
        continue
      }

      ctx.beginPath()
      if (radius > 0) ctx.roundRect(x, y, w, h, radius)
      else ctx.rect(x, y, w, h)
      ctx.fillStyle = lit ? theme.highlightFill : unlitFill
      ctx.fill()
      if (frame.tier !== 'block') {
        ctx.strokeStyle = lit ? theme.highlightStroke : theme.nodeStroke
        ctx.lineWidth = theme.nodeStrokeWidth
        ctx.stroke()
      }
      calls.nodes++

      if (i === frame.dragIndex || revealAlpha < 1) ctx.globalAlpha = 1
    }

    if (frame.tier !== 'block' && frame.labels.length > 0) {
      ctx.fillStyle = theme.labelColour
      ctx.font = theme.labelFont
      ctx.textBaseline = 'middle'
      const pad = theme.labelPadding * k
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
