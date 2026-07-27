/**
 * The card that follows the cursor during a drag.
 *
 * The node being dragged stays where it is, dimmed (the engine's own
 * `dragGhostAlpha`), and a copy travels — which is the convention every file
 * manager and every tree editor uses, and for a reason worth stating: the
 * original is where the node still IS until you let go, and a drag you can
 * abandon has to leave something behind to abandon it to.
 *
 * The copy is a CLONE of the node's own overlay element rather than something
 * drawn for the occasion. A host's card can be anything — an avatar, a status
 * badge, a photo — and a ghost that approximated it would be a second card
 * design to keep in step with the first. Cloning means it looks exactly right
 * by construction, including whatever CSS the host wrote for it.
 *
 * Below the overlay LOD threshold there is no element to clone, because the
 * chart is drawing plain shapes; the ghost then falls back to a small label,
 * which is also all the canvas is showing at that zoom.
 */
export interface DragGhost {
  /**
   * Starts following the pointer. `source` is the dragged node's own overlay
   * element, or `null` when the chart is zoomed out past the overlay
   * threshold. `count` above 1 adds a badge — a multi-node drag has to say how
   * many, or the viewer is holding an unknown quantity.
   */
  show(source: HTMLElement | null, label: string, count: number): void
  move(screenX: number, screenY: number): void
  hide(): void
  destroy(): void
}

export function createDragGhost(host: HTMLElement): DragGhost {
  let element: HTMLDivElement | null = null

  const ensure = (): HTMLDivElement => {
    if (element !== null) return element
    element = document.createElement('div')
    element.className = 'klad-drag-ghost'
    // Inline rather than left to a stylesheet: these four are not styling
    // choices a host should be able to break. A ghost that intercepted its own
    // pointer events would swallow the drag that is drawing it, and one that
    // participated in layout would reflow the page it floats over.
    element.style.position = 'absolute'
    element.style.top = '0'
    element.style.left = '0'
    element.style.pointerEvents = 'none'
    element.style.zIndex = '20'
    host.appendChild(element)
    return element
  }

  return {
    show(source, label, count) {
      const ghost = ensure()
      ghost.innerHTML = ''
      if (source === null) {
        const plain = document.createElement('div')
        plain.className = 'klad-drag-ghost-label'
        plain.textContent = label
        ghost.append(plain)
      } else {
        const clone = source.cloneNode(true) as HTMLElement
        // The original is positioned by the overlay against the camera; the
        // copy is positioned against the POINTER, so it must not carry the
        // transform that put the original where it was.
        clone.style.transform = ''
        clone.style.position = 'static'
        clone.style.opacity = ''
        ghost.append(clone)
      }
      if (count > 1) {
        const badge = document.createElement('span')
        badge.className = 'klad-drag-ghost-count'
        badge.textContent = String(count)
        ghost.append(badge)
      }
      ghost.hidden = false
    },
    move(screenX, screenY) {
      if (element === null) return
      // Offset from the cursor rather than centred on it: a ghost under the
      // pointer covers the very thing the drop preview is trying to show you.
      element.style.transform = `translate3d(${screenX + 12}px, ${screenY + 12}px, 0)`
    },
    hide() {
      if (element === null) return
      element.hidden = true
      element.innerHTML = ''
    },
    destroy() {
      element?.remove()
      element = null
    },
  }
}
