import { worldToScreen, type Camera } from '@klados/core'

export interface OverlayItem {
  /** Source node index. */
  index: number
  id: string
}

export interface OverlayCallbacks {
  render(element: HTMLElement, item: OverlayItem): void
}

/**
 * Positions framework-rendered node elements over the canvas.
 *
 * Elements are pooled by slot, not by node: panning reassigns which node each
 * slot shows rather than destroying and recreating DOM. Recreating on every
 * frame is what makes overlay approaches stutter.
 */
export function createOverlay(container: HTMLElement, callbacks: OverlayCallbacks) {
  const pool: HTMLElement[] = []
  let activeCount = 0

  const acquire = (): HTMLElement => {
    const existing = pool[activeCount]
    if (existing !== undefined) {
      // A slot that was idle last frame was detached (see the tail loop below),
      // not destroyed — the element object is the same one a caller may still
      // be holding a reference to. Reattaching it is cheap; recreating it would
      // not be the same object.
      if (existing.parentNode !== container) container.appendChild(existing)
      return existing
    }
    const element = document.createElement('div')
    element.className = 'klados-overlay-node'
    element.style.position = 'absolute'
    element.style.top = '0'
    element.style.left = '0'
    element.style.transformOrigin = '0 0'
    container.appendChild(element)
    pool.push(element)
    return element
  }

  return {
    /**
     * `items` are the nodes to show; `boxes` and `sourceToBox` locate them.
     * Pass an empty list to clear the overlay without tearing the pool down.
     *
     * `alphaOf` reports the canvas's own per-node reveal alpha (1 for
     * anything not fading). A card MUST honour it: an expand holds newly
     * revealed nodes at alpha 0 for its whole first phase while their room is
     * being made, at a box that is still a zero-size point on the parent's
     * edge, so a card ignoring it paints its content — unclipped, since the
     * element it overflows is 0x0 — as a bubble hanging off the parent until
     * the reveal finally starts.
     */
    update(
      items: readonly OverlayItem[],
      boxOf: (index: number) => { x: number; y: number; w: number; h: number } | null,
      camera: Camera,
      alphaOf: (index: number) => number,
    ): void {
      activeCount = 0
      for (const item of items) {
        const box = boxOf(item.index)
        if (box === null) continue
        const element = acquire()
        const screen = worldToScreen(camera, box.x, box.y)
        element.style.width = `${box.w}px`
        element.style.height = `${box.h}px`
        element.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${camera.k})`
        // Cleared to '' rather than '1' at full opacity so a card that is not
        // fading carries no inline opacity at all — the steady state leaves
        // the element exactly as it was before this feature existed, and a
        // host styling `.klados-overlay-node` opacity itself is not
        // overridden by an inline rule on every frame.
        const alpha = alphaOf(item.index)
        element.style.opacity = alpha >= 1 ? '' : String(alpha)
        callbacks.render(element, item)
        activeCount++
      }
      // Idle slots are detached, not merely hidden: a class-based DOM query
      // (as opposed to a visibility check) must see zero overlay nodes once
      // nothing is showing, e.g. after zooming below the overlay LOD
      // threshold. The element objects themselves survive in `pool` — only
      // their DOM attachment is torn down, so a slot coming back into use
      // (`acquire` above) reattaches the very same node instead of creating
      // a new one.
      for (let i = activeCount; i < pool.length; i++) {
        pool[i]!.remove()
      }
    },

    destroy(): void {
      for (const element of pool) element.remove()
      pool.length = 0
      activeCount = 0
    },
  }
}
