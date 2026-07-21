import { pan, screenToWorld, zoomAt, type Camera, type ZoomLimits } from '@n1crack/orgchart-core'

export interface InputCallbacks {
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** Screen-space point, relative to the canvas. */
  onTap(screenX: number, screenY: number): void
}

const WHEEL_STEP = 1.0015
const DRAG_THRESHOLD_PX = 4

/**
 * Translates pointer, wheel, and pinch gestures into camera changes.
 *
 * A press that never travels more than `DRAG_THRESHOLD_PX` is a tap, not a pan —
 * without that distinction every click would also nudge the camera, and clicks
 * on a trackpad always travel a pixel or two.
 *
 * Move and up are bound on `window`, not the canvas, so a drag that leaves the
 * element still tracks and still ends.
 */
export function attachInput(
  canvas: HTMLCanvasElement,
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
  const activePointers = new Map<number, { x: number; y: number }>()
  let pinchDistance = 0

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: PointerEvent): void => {
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
  }

  const onPointerUp = (event: PointerEvent): void => {
    activePointers.delete(event.pointerId)
    if (activePointers.size < 2) pinchDistance = 0
    if (!dragging) return
    dragging = false
    if (travelled <= DRAG_THRESHOLD_PX) {
      const point = localPoint({ clientX: downX, clientY: downY })
      callbacks.onTap(point.x, point.y)
    }
  }

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const point = localPoint(event)
    callbacks.setCamera(
      zoomAt(callbacks.getCamera(), point.x, point.y, Math.pow(WHEEL_STEP, -event.deltaY), limitsOf()),
    )
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
  }
}

export { screenToWorld }
