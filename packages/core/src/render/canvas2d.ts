import type { TextMeasurer } from '../text/measure.js'
import type { DrawCallStats, Frame, Renderer, RenderSurface } from './renderer.js'
import type { Theme } from './theme.js'

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
  let cssWidth = 0
  let cssHeight = 0
  let devicePixelRatio = 1

  const stats = { lastDrawCalls: { edgeStrokes: 0, nodes: 0, labels: 0 } as DrawCallStats }

  const resize = (width: number, height: number, dpr: number): void => {
    cssWidth = width
    cssHeight = height
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

    const { boxes, parent, visible, visibleCount, camera } = frame
    const k = camera.k

    // Edges first so nodes paint over the joins.
    if (visibleCount > 0) {
      ctx.beginPath()
      for (let n = 0; n < visibleCount; n++) {
        const i = visible[n]!
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
    for (let n = 0; n < visibleCount; n++) {
      const i = visible[n]!
      const o = i * 4
      const x = boxes[o]! * k + camera.x
      const y = boxes[o + 1]! * k + camera.y
      const w = boxes[o + 2]! * k
      const h = boxes[o + 3]! * k
      const lit = frame.highlight !== null && frame.highlight[i] === 1

      if (i === frame.dragIndex) ctx.globalAlpha = theme.dragGhostAlpha

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

      if (i === frame.dragIndex) ctx.globalAlpha = 1
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
        ctx.fillText(
          text,
          boxes[o]! * k + camera.x + pad,
          (boxes[o + 1]! + boxes[o + 3]! / 2) * k + camera.y,
        )
        calls.labels++
      }
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
