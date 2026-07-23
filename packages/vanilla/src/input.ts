import { pan, screenToWorld, zoomAt, type Camera, type ZoomLimits } from '@klad/engine'

export interface InputCallbacks {
  getCamera(): Camera
  setCamera(camera: Camera): void
  /**
   * Called the instant the user touches the chart (pointerdown) or turns the
   * wheel — before any camera math for that gesture runs. Pan, wheel-zoom, and
   * pinch all report their own camera changes through `setCamera`, which is
   * instantaneous; this hook exists separately so a tween the vanilla layer has
   * in flight is cancelled at the moment of contact rather than at the moment
   * the gesture happens to produce its first delta. That is what makes "the
   * user's hand on the canvas wins immediately" true even for a press that
   * turns out to be a tap.
   */
  cancelAnimation(): void
  /**
   * Screen-space point, relative to the chart host element, plus the
   * `pointerdown` event's own `target` — the deepest DOM element actually
   * under the pointer when the gesture started, canvas or an overlay card's
   * own content alike. Passed through (rather than re-derived later, e.g.
   * via `elementFromPoint`) so a caller can tell a tap on a card's own
   * interactive content (a button, a link) apart from a tap on the card's
   * inert body, without this module needing to know anything about what a
   * "toggle button" or an "interactive element" is — that judgement belongs
   * to the caller (see `toggleOnNodeClick` in index.ts).
   */
  onTap(
    screenX: number,
    screenY: number,
    target: EventTarget | null,
    modifiers: { additive: boolean; extend: boolean },
  ): void
  /**
   * Screen-space point, relative to the chart host element. Fired for plain
   * hover motion — not while dragging or pinching, since those already
   * report through `setCamera` and re-running a hit test on every pan frame
   * would be pure waste.
   */
  onMove(screenX: number, screenY: number): void
  /** The pointer has left the chart (canvas and overlay cards alike). */
  onLeave(): void
  /**
   * A single-pointer drag (not a pinch) just ended. `vx`/`vy` are the release
   * velocity in screen px/ms, estimated from a short rolling window of recent
   * samples — see the `VELOCITY_WINDOW_MS` comment below. Not called for a tap,
   * and not called when the window's time span is too short to trust (also
   * below) — the caller (vanilla layer) decides whether to actually start a
   * momentum coast from this.
   */
  onRelease(vx: number, vy: number): void
}

const WHEEL_STEP = 1.0015
const DRAG_THRESHOLD_PX = 4

/**
 * Translates pointer, wheel, and pinch gestures into camera changes.
 *
 * Bound on the chart *host* element, not the canvas — the DOM overlay that
 * renders framework node content sits above the canvas as a sibling, with
 * `pointer-events: auto` on its cards so their own content (buttons, links)
 * is interactive. At the zoom levels where the overlay renders, most of the
 * visible surface is cards, not bare canvas: binding to the canvas alone
 * meant a press that started on a card never reached this handler at all, so
 * dragging from a card silently did nothing. The host contains both the
 * canvas and the overlay, so a press anywhere in the chart reaches it.
 *
 * Because pointerdown is never `preventDefault()`-ed here, a card's own
 * interactive content (a toggle button, a link) still receives its own
 * click/focus normally — this only observes the gesture, it doesn't consume it.
 *
 * A press that never travels more than `DRAG_THRESHOLD_PX` is a tap, not a pan —
 * without that distinction every click would also nudge the camera, and clicks
 * on a trackpad always travel a pixel or two.
 *
 * Only the PRIMARY button pans (see `onPointerDown`), so a right-click is left
 * entirely to the browser and to any host-installed context menu.
 *
 * Move and up are bound on `window`, not the host, so a drag that leaves the
 * element still tracks and still ends.
 *
 * On touch, the browser's own scroll/pinch handling would otherwise consume
 * the same gestures this module is claiming — a one-finger drag would scroll
 * the page instead of panning the chart, and a two-finger pinch would zoom the
 * whole document rather than the camera. `touch-action: none` on the host is
 * what hands those gestures to this handler; it is set here, alongside the
 * listeners that need it, and restored on teardown.
 */
export function attachInput(
  host: HTMLElement,
  /**
   * Read as a getter, not captured. The zoom floor moves with the content: a chart
   * wider than the viewport lowers it so Fit can show everything. Snapshotting the
   * limits here would clamp against a stale floor forever after.
   */
  limitsOf: () => ZoomLimits,
  callbacks: InputCallbacks,
): () => void {
  let dragging = false
  let travelled = 0
  let lastX = 0
  let lastY = 0
  let downX = 0
  let downY = 0
  // The `pointerdown` event's own `target`, carried through to `onTap` if
  // this gesture turns out to be a tap rather than a drag — see `onTap`'s
  // docblock above for why the caller needs this.
  let downTarget: EventTarget | null = null
  // Read at press rather than at release: a viewer who lets go of ctrl before
  // lifting the finger still meant ctrl-click, and the press is when they
  // decided.
  let downAdditive = false
  let downExtend = false
  const activePointers = new Map<number, { x: number; y: number }>()
  let pinchDistance = 0

  // Hover: throttled to at most one hit test per animation frame, and skipped
  // entirely when the pointer hasn't actually moved since the last one — a
  // pointer generates far more 'move' events per second than there are frames,
  // and re-running a quadtree query for an unchanged position is pure waste.
  let hoverPoint: { x: number; y: number } | null = null
  let hoverFrame: number | null = null

  // Kinetic panning: a rolling window of recent (time, x, y) samples taken
  // during an active single-pointer drag, used at release to estimate
  // velocity from the span of the window rather than the single last delta —
  // one jittery final event must not be able to fling the chart on its own.
  const VELOCITY_WINDOW_MS = 100
  // Below this, the window's own time span is too short to trust as a real
  // velocity measurement — e.g. two samples a fraction of a millisecond apart
  // (synchronous event dispatch, or a coarsened clock) would otherwise imply
  // an enormous, meaningless speed. Below the threshold, momentum just isn't
  // started; the drag stops the way it always did.
  const MIN_VELOCITY_SAMPLE_MS = 8
  let moveSamples: { t: number; x: number; y: number }[] = []

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = host.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: PointerEvent): void => {
    // Primary button only. `button` is 0 for a left click, a touch contact and
    // a pen tip alike, so this costs touch nothing — it excludes exactly the
    // secondary/middle/back buttons. Without it, the press that opens the
    // browser's context menu ALSO started a pan, so the chart slid out from
    // under the menu that had just opened over it; the same went for a
    // middle-click, which panned while the browser started its own auto-scroll.
    // Checked before `activePointers` is touched so a right-click can't count
    // toward the two-pointer pinch either.
    if (event.button !== 0) return
    callbacks.cancelAnimation()
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (activePointers.size === 2) {
      const [a, b] = Array.from(activePointers.values())
      pinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      dragging = false
      return
    }
    dragging = true
    travelled = 0
    lastX = event.clientX
    lastY = event.clientY
    downX = event.clientX
    downY = event.clientY
    downTarget = event.target
    downAdditive = event.ctrlKey || event.metaKey
    downExtend = event.shiftKey
    moveSamples = [{ t: performance.now(), x: event.clientX, y: event.clientY }]
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }

    if (activePointers.size === 2) {
      const [a, b] = Array.from(activePointers.values())
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      if (pinchDistance > 0 && distance > 0) {
        const midpoint = localPoint({
          clientX: (a!.x + b!.x) / 2,
          clientY: (a!.y + b!.y) / 2,
        })
        callbacks.setCamera(
          zoomAt(callbacks.getCamera(), midpoint.x, midpoint.y, distance / pinchDistance, limitsOf()),
        )
      }
      pinchDistance = distance
      return
    }

    if (!dragging) return
    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    lastX = event.clientX
    lastY = event.clientY
    travelled += Math.abs(dx) + Math.abs(dy)
    callbacks.setCamera(pan(callbacks.getCamera(), dx, dy))

    const now = performance.now()
    moveSamples.push({ t: now, x: event.clientX, y: event.clientY })
    while (moveSamples.length > 1 && now - moveSamples[0]!.t > VELOCITY_WINDOW_MS) {
      moveSamples.shift()
    }
  }

  const onPointerUp = (event: PointerEvent): void => {
    activePointers.delete(event.pointerId)
    if (activePointers.size < 2) pinchDistance = 0
    if (!dragging) return
    dragging = false
    if (travelled <= DRAG_THRESHOLD_PX) {
      const point = localPoint({ clientX: downX, clientY: downY })
      callbacks.onTap(point.x, point.y, downTarget, { additive: downAdditive, extend: downExtend })
      return
    }
    const first = moveSamples[0]
    const last = moveSamples[moveSamples.length - 1]
    if (first !== undefined && last !== undefined) {
      const dt = last.t - first.t
      if (dt >= MIN_VELOCITY_SAMPLE_MS) {
        callbacks.onRelease((last.x - first.x) / dt, (last.y - first.y) / dt)
      }
    }
  }

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    callbacks.cancelAnimation()
    const point = localPoint(event)
    callbacks.setCamera(
      zoomAt(callbacks.getCamera(), point.x, point.y, Math.pow(WHEEL_STEP, -event.deltaY), limitsOf()),
    )
  }

  const onHoverMove = (event: PointerEvent): void => {
    // A drag or a pinch already reports every frame through `setCamera`;
    // hover is for the idle-pointer case only.
    if (dragging || activePointers.size > 0) return
    const point = localPoint(event)
    if (hoverPoint !== null && hoverPoint.x === point.x && hoverPoint.y === point.y) return
    hoverPoint = point
    if (hoverFrame !== null) return
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = null
      if (hoverPoint !== null) callbacks.onMove(hoverPoint.x, hoverPoint.y)
    })
  }

  const onHoverLeave = (): void => {
    hoverPoint = null
    callbacks.onLeave()
  }

  // Saved and restored rather than simply cleared on teardown: the host is the
  // consumer's own element, which may well carry a `touch-action` of its own.
  const previousTouchAction = host.style.touchAction
  const previousUserSelect = host.style.userSelect
  host.style.touchAction = 'none'
  // A pan that starts on an overlay card would otherwise drag-SELECT that
  // card's text (pointerdown is deliberately never `preventDefault()`-ed here,
  // so the browser's own selection gesture still runs) — a chart left striped
  // with highlighted labels after every pan, and on touch a long-press that
  // pops the selection handles mid-drag. Buttons, links and form controls in a
  // card are unaffected: this suppresses selection, not interaction.
  host.style.userSelect = 'none'

  host.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  host.addEventListener('wheel', onWheel, { passive: false })
  host.addEventListener('pointermove', onHoverMove)
  host.addEventListener('pointerleave', onHoverLeave)

  return () => {
    host.style.touchAction = previousTouchAction
    host.style.userSelect = previousUserSelect
    host.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    host.removeEventListener('wheel', onWheel)
    host.removeEventListener('pointermove', onHoverMove)
    host.removeEventListener('pointerleave', onHoverLeave)
    if (hoverFrame !== null) cancelAnimationFrame(hoverFrame)
  }
}

export { screenToWorld }
