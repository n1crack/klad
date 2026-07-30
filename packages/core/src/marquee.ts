/**
 * Dragging out a region to select with: a rectangle, or a freehand lasso.
 *
 * Both are the same gesture with different geometry, so they share one module
 * and one drag loop. The shape itself is drawn as a DOM overlay rather than
 * being added to the canvas pipeline: it is chrome over the drawing, it exists
 * for the length of one drag, and putting it through layout, the worker
 * protocol and the renderer would be three round trips to draw a dotted
 * rectangle.
 *
 * A modifier is required to start one, and the reason is that the plain drag
 * is already taken: dragging the background pans, and a chart you cannot pan
 * without holding a key would be a worse chart than one where selecting takes
 * a modifier. Shift draws a box; Alt draws a lasso.
 */
export interface MarqueeCallbacks {
  /**
   * The gesture finished over these host-relative points. A box reports its
   * two corners; a lasso reports its whole path, closed implicitly.
   * `additive` is true when the viewer asked to add to the selection rather
   * than replace it — ctrl or meta held alongside.
   */
  onRegion(points: { x: number; y: number }[], additive: boolean): void
}

export type MarqueeKind = 'box' | 'lasso'

/** Below this, the gesture was a click that wobbled, not a region. */
const MIN_TRAVEL_PX = 6

export function attachMarquee(host: HTMLElement, callbacks: MarqueeCallbacks): () => void {
  let kind: MarqueeKind | null = null
  let additive = false
  let points: { x: number; y: number }[] = []
  let travelled = 0
  let shape: SVGSVGElement | null = null
  let path: SVGPathElement | null = null

  const localPoint = (event: PointerEvent): { x: number; y: number } => {
    const rect = host.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /**
   * One SVG element for the shape, created on first use and reused after.
   * `pointer-events: none` so it never intercepts the drag drawing it, and
   * absolutely positioned over the host so its coordinates ARE host
   * coordinates — no transform to keep in step with the camera, because the
   * marquee lives in screen space and the nodes it will select are looked up
   * in screen space too.
   */
  const ensureShape = (): SVGPathElement => {
    if (path !== null) return path
    shape = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    shape.setAttribute('class', 'klad-marquee')
    shape.style.position = 'absolute'
    shape.style.inset = '0'
    shape.style.pointerEvents = 'none'
    shape.style.overflow = 'visible'
    path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    // Styled inline so the gesture is visible in a host that ships no CSS for
    // it at all; `.klad-marquee` is there for a host that wants its own.
    path.setAttribute('fill', 'rgba(37, 99, 235, 0.12)')
    path.setAttribute('stroke', 'rgba(37, 99, 235, 0.9)')
    path.setAttribute('stroke-width', '1')
    path.setAttribute('stroke-dasharray', '4 3')
    shape.appendChild(path)
    host.appendChild(shape)
    return path
  }

  const describe = (): string => {
    if (points.length === 0) return ''
    if (kind === 'lasso') {
      return `M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`
    }
    const first = points[0]!
    const last = points[points.length - 1]!
    const x = Math.min(first.x, last.x)
    const y = Math.min(first.y, last.y)
    const w = Math.abs(last.x - first.x)
    const h = Math.abs(last.y - first.y)
    return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`
  }

  const clear = (): void => {
    kind = null
    points = []
    travelled = 0
    if (shape !== null) shape.remove()
    shape = null
    path = null
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    const wanted: MarqueeKind | null = event.shiftKey ? 'box' : event.altKey ? 'lasso' : null
    if (wanted === null) return
    // `stopImmediatePropagation`, not `stopPropagation`: the pan handler is
    // bound to the SAME element, and stopping propagation only keeps an event
    // from ancestors — it does nothing about a sibling listener on the node
    // itself. Without this the chart pans out from under the region being
    // drawn on it, which is exactly what it did the first time round: the
    // nodes had moved a screen-width away by the time the region was tested
    // against them, so a box over the whole chart selected nothing.
    //
    // It relies on this module being attached BEFORE the pointer input (see
    // `createKlad`), since immediate propagation only stops listeners
    // registered after this one.
    event.preventDefault()
    event.stopImmediatePropagation()
    kind = wanted
    additive = event.ctrlKey || event.metaKey
    points = [localPoint(event)]
    travelled = 0
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (kind === null) return
    const point = localPoint(event)
    const previous = points[points.length - 1]!
    travelled += Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)
    // A box only ever needs its two corners; a lasso needs the whole path, but
    // not every sample of it — a point every few pixels is enough to test
    // against and keeps a long slow drag from accumulating thousands.
    if (kind === 'box') points[1] = point
    else if (Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) >= 4) points.push(point)
    ensureShape().setAttribute('d', describe())
  }

  const onPointerUp = (): void => {
    if (kind === null) return
    const region = points
    const wasAdditive = additive
    const enough = travelled > MIN_TRAVEL_PX && region.length >= 2
    clear()
    if (enough) callbacks.onRegion(region, wasAdditive)
  }

  // Down on the host (the gesture starts on the chart), move and up on the
  // window, so a drag that leaves the element still tracks and still ends —
  // the same arrangement `input.ts` uses, for the same reason.
  host.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  return () => {
    clear()
    host.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  }
}

/**
 * True when `point` is inside the polygon — the standard ray cast, counting
 * how many edges a ray to the right crosses. Odd means inside.
 *
 * Used for the lasso; a box is a bounds check the caller does directly.
 */
export function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    const straddles = a.y > point.y !== b.y > point.y
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
