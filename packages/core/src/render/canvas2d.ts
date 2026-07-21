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
  theme: Theme,
  measurerFor: (font: string) => TextMeasurer,
): Renderer {
  const ctx = surface.getContext('2d')
  if (ctx === null) throw new Error('OrgChart: 2D canvas context unavailable')

  const measurer = measurerFor(theme.labelFont)
  let devicePixelRatio = 1

  const stats = { lastDrawCalls: { edgeStrokes: 0, nodes: 0, labels: 0 } as DrawCallStats }

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
    if (edgeCount > 0) {
      ctx.beginPath()
      for (let n = 0; n < edgeCount; n++) {
        const i = edges[n]!
        const p = parent[i]!
        if (p === -1) continue
        const io = i * 4
        const po = p * 4
        if (frame.horizontal) {
          // Growth axis is x: leave the parent's right edge, split on x.
          const px = (boxes[po]! + boxes[po + 2]!) * k + camera.x
          const py = (boxes[po + 1]! + boxes[po + 3]! / 2) * k + camera.y
          const cx = boxes[io]! * k + camera.x
          const cy = (boxes[io + 1]! + boxes[io + 3]! / 2) * k + camera.y
          const midX = (px + cx) / 2
          ctx.moveTo(px, py)
          ctx.lineTo(midX, py)
          ctx.lineTo(midX, cy)
          ctx.lineTo(cx, cy)
        } else {
          const px = (boxes[po]! + boxes[po + 2]! / 2) * k + camera.x
          const py = (boxes[po + 1]! + boxes[po + 3]!) * k + camera.y
          const cx = (boxes[io]! + boxes[io + 2]! / 2) * k + camera.x
          const cy = boxes[io + 1]! * k + camera.y
          const midY = (py + cy) / 2
          ctx.moveTo(px, py)
          ctx.lineTo(px, midY)
          ctx.lineTo(cx, midY)
          ctx.lineTo(cx, cy)
        }
      }
      ctx.strokeStyle = theme.edgeStroke
      ctx.lineWidth = theme.edgeWidth
      ctx.stroke()
      calls.edgeStrokes = 1
    }

    const radius = frame.tier === 'block' ? 0 : theme.cornerRadius * k

    // Nodes a collapse is still removing, drawn before the surviving nodes
    // so a settled ancestor paints crisply over whatever is shrinking into
    // it. No connector, no label, no highlight/drag handling — a ghost is
    // gone from the pruned tree and none of those concepts apply to it.
    if (frame.ghostCount > 0) {
      for (let g = 0; g < frame.ghostCount; g++) {
        const o = g * 4
        const x = frame.ghostBoxes[o]! * k + camera.x
        const y = frame.ghostBoxes[o + 1]! * k + camera.y
        const w = frame.ghostBoxes[o + 2]! * k
        const h = frame.ghostBoxes[o + 3]! * k
        ctx.globalAlpha = frame.ghostAlpha[g]!
        ctx.beginPath()
        if (radius > 0) ctx.roundRect(x, y, w, h, radius)
        else ctx.rect(x, y, w, h)
        ctx.fillStyle = theme.nodeFill
        ctx.fill()
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

      ctx.beginPath()
      if (radius > 0) ctx.roundRect(x, y, w, h, radius)
      else ctx.rect(x, y, w, h)
      ctx.fillStyle = lit ? theme.highlightFill : theme.nodeFill
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

  return {
    resize,
    draw,
    get stats() {
      return stats
    },
  }
}
