/**
 * Keyboard control of the CAMERA, for someone looking at the chart rather than
 * reading it.
 *
 * This is a different job from `a11y.ts`, and the difference is the reason
 * both exist. That module mirrors the tree as `role="tree"` rows so a screen
 * reader can walk the structure — arrows there move between NODES. This one
 * moves the VIEW: arrows pan, `+`/`-` zoom, `f` fits. It is what a sighted
 * user reaches for after clicking the chart, and until it existed the answer
 * was "nothing happens", because the host was not focusable and no key was
 * bound anywhere outside the hidden tree.
 *
 * The host becomes a tab stop for the same reason: a chart you can click but
 * cannot Tab to is a chart the keyboard cannot start using at all. It is the
 * FIRST stop inside the chart, ahead of any overlay card's own buttons, so
 * "Tab, then arrows" works without walking past fifty cards to get there.
 */
import { pan, zoomAt, type Camera, type ZoomLimits } from '@klad/engine'

export interface KeyCallbacks {
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** Cancels a tween or a momentum coast, exactly as a pointer press does. */
  cancelAnimation(): void
  /** The host's own size, for zooming about its centre. */
  viewport(): { width: number; height: number }
  fit(): void
  reset(): void
  /** Centre the root, so there is a way back from anywhere. */
  goToRoot(): void
  /** Escape: drop whatever the chart is currently pointing at. */
  clearHighlight(): void
}

/**
 * One press moves the view by this much, in screen pixels — about a card and a
 * half at 1:1, so a press is a step rather than a nudge, and holding the key
 * (which repeats) crosses the viewport in roughly a second.
 */
const PAN_STEP = 96

/** Shift makes it a stride, for crossing a chart rather than adjusting a view. */
const PAN_STRIDE = 4

/** Per press, matching `zoomIn`/`zoomOut` on the API so both agree. */
const ZOOM_STEP = 1.2

/**
 * True for a target that is already using the keyboard for its own purpose:
 * an input in an overlay card, a `<select>`, anything `contenteditable`, or a
 * row of the accessibility tree (which has its own arrow-key handling for
 * moving between nodes). Panning the camera out from under any of those would
 * be a bug, not a feature.
 */
function ownsTheKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.dataset.orgchartId !== undefined) return true
  if (target.isContentEditable) return true
  return ['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(target.tagName)
}

export function attachKeys(
  host: HTMLElement,
  limitsOf: () => ZoomLimits,
  callbacks: KeyCallbacks,
): () => void {
  // Saved and restored rather than cleared: the host is the consumer's own
  // element and may already have been a tab stop for a reason of its own.
  const previousTabIndex = host.getAttribute('tabindex')
  if (previousTabIndex === null) host.tabIndex = 0

  const onKeyDown = (event: KeyboardEvent): void => {
    // A modified press belongs to the browser or the OS — ctrl+arrow, cmd+plus
    // and friends are not ours to take. Shift is the exception: it is this
    // module's own modifier, and nothing else claims shift+arrow here.
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (ownsTheKeyboard(event.target)) return

    const step = PAN_STEP * (event.shiftKey ? PAN_STRIDE : 1)
    // Arrows move the VIEW in the direction pressed, so the content moves the
    // other way — the same relationship a scrollbar has with its page, and the
    // opposite of dragging, where the content follows the hand.
    const pans: Record<string, [x: number, y: number] | undefined> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }

    const panBy = pans[event.key]
    if (panBy !== undefined) {
      event.preventDefault()
      callbacks.cancelAnimation()
      callbacks.setCamera(pan(callbacks.getCamera(), panBy[0], panBy[1]))
      return
    }

    switch (event.key) {
      // `=` because that is the unshifted key `+` lives on: requiring shift to
      // zoom in would make the pair asymmetric with `-`.
      case '+':
      case '=': {
        event.preventDefault()
        zoomAbouCentre(ZOOM_STEP)
        return
      }
      case '-':
      case '_': {
        event.preventDefault()
        zoomAbouCentre(1 / ZOOM_STEP)
        return
      }
      case 'f':
      case 'F': {
        event.preventDefault()
        callbacks.fit()
        return
      }
      case '0': {
        event.preventDefault()
        callbacks.reset()
        return
      }
      case 'Home': {
        event.preventDefault()
        callbacks.goToRoot()
        return
      }
      case 'Escape': {
        callbacks.clearHighlight()
        return
      }
      default:
        return
    }
  }

  const zoomAbouCentre = (factor: number): void => {
    callbacks.cancelAnimation()
    const { width, height } = callbacks.viewport()
    callbacks.setCamera(zoomAt(callbacks.getCamera(), width / 2, height / 2, factor, limitsOf()))
  }

  host.addEventListener('keydown', onKeyDown)

  return () => {
    host.removeEventListener('keydown', onKeyDown)
    if (previousTabIndex === null) host.removeAttribute('tabindex')
    else host.setAttribute('tabindex', previousTabIndex)
  }
}
