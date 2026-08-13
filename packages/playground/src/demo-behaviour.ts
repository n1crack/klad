import type { KladApi } from '@klad/core'
import { accordionProgress, centreControlFor, type Example, type LayoutName } from './data.js'

/**
 * The parts of a demo that are not about the framework.
 *
 * Three of the playground's examples do something a card alone cannot: the
 * sunburst drills in, the go-to-node button flies somewhere and marks the
 * route, and the accordion animates a node's SIZE. None of that is Vue or
 * React or DOM — it is `KladApi` calls in a particular order, and the order is
 * the interesting part.
 *
 * Written once here and used by all three demos, because the alternative was
 * writing it three times: the vanilla demo had it and the other two did not,
 * which is why half the examples only worked on one stack. A playground whose
 * whole claim is "the same thing in three frameworks" cannot afford a third of
 * its examples to be a different thing.
 *
 * What is deliberately NOT here is the subscription. Each stack has its own
 * idiomatic way to hear about a click — `chart.on`, a Vue emit, a React prop —
 * and a module that insisted on one of them would force the other two to grow
 * an adapter for it. So this exports the DECISION and lets each stack deliver
 * the event however it already does.
 */

/**
 * The sunburst's drill-down, as a pure decision: given the node that was
 * clicked, what should the centre become?
 *
 * Two gestures, and the second is what makes it navigable. Clicking a segment
 * drills INTO it; clicking the one already at the centre steps back OUT to its
 * parent. So the hub always means "go up", which is where a viewer will look
 * for it.
 *
 * Returns `undefined` when nothing should happen — this layout has no centre,
 * or the click was on the root's own hub, where there is nowhere further out
 * and blanking the wheel would be the wrong answer to "go up".
 */
export function createDrill(
  example: Example,
  layout: LayoutName,
): (clickedId: string, currentCentre: string | null, api: KladApi) => string | null | undefined {
  if (!centreControlFor(layout)) return () => undefined

  const parentOf = new Map<string, string | null>()
  for (const item of example.data) {
    parentOf.set(String(item.id), (item.parentId as string | null) ?? null)
  }
  const rootId = example.data[0] === undefined ? null : String(example.data[0].id)

  return (clickedId, currentCentre, api) => {
    // An aggregate node stands for a handful of siblings too small to draw —
    // it has no children of its own, so drilling into it centres on a node
    // with nothing inside and leaves a viewer looking at one flat disc with no
    // way back but the breadcrumb. What a click there means is "show me the
    // ones you rolled up", which is exactly `showMore`.
    if (api.overflow(clickedId) !== null) {
      api.showMore(clickedId)
      return undefined
    }
    const centre = currentCentre ?? rootId
    if (clickedId !== centre) return clickedId
    const parent = parentOf.get(clickedId) ?? null
    return parent === null ? undefined : parent
  }
}

/**
 * The go-to-node command, in one gesture: mark the way from the root, then fly
 * there and flash the ring on arrival.
 *
 * `pathTo` returns the root-to-node id chain, which is exactly what
 * `highlight` wants, and `focus` opens every collapsed ancestor on the way —
 * so this works from a fully closed chart, not only when the target already
 * happens to be on screen.
 */
export function goTo(api: KladApi, id: string): void {
  api.highlight(api.pathTo(id))
  api.focus(id, { ring: true })
}

/**
 * Eases every accordion card's `detailT` toward its open/closed target and
 * re-measures the chart on each frame, which is what turns a size change into
 * a slide: `nodeSize` is read at layout time, so animating the size means
 * animating the number it returns and re-measuring as it changes.
 *
 * One `refresh()` per frame for the ~200ms this runs. That is a full relayout
 * per frame, which is affordable here — the example is 28 nodes — and
 * deliberately not what the library does for its own expand/collapse
 * transition, which interpolates already-computed positions precisely so it
 * never relayouts per frame. An app animating node sizes on a large tree
 * should expect the same distinction to matter.
 */
/**
 * Lights the route from the root to whatever the pointer is over.
 *
 * `pathTo` gives the chain of ids, `highlight` lights it, and the chart draws
 * the connectors along it in its own highlight ink — thicker, and with the
 * halo this example's theme asks for. That is the whole of it: no per-node
 * bookkeeping, no hover class on a card, and nothing to undo, because the next
 * call replaces the set and a `null` clears it.
 *
 * Returns a handler rather than subscribing itself, so each demo can attach it
 * the way its own stack does and drop it with the rest of its listeners.
 */
export function createHoverTrail(
  apiOf: () => KladApi | null | undefined,
  example: Example,
): (event: { id: string | null }) => void {
  return (event) => {
    reportHover(event.id)
    // `'node'` lights only what the pointer is actually on. On a wheel the
    // path to the root is the ring stack the segment already sits inside, so
    // lighting it says nothing the picture was not saying — what a viewer
    // wants confirmed there is "this one, the one I am pointing at".
    const mode = example.hoverTrail === true ? 'path' : (example.hoverHighlight ?? null)
    if (mode === null) return
    const api = apiOf()
    if (api === null || api === undefined) return
    if (event.id === null) {
      api.highlight(null)
      return
    }
    api.highlight(mode === 'path' ? api.pathTo(event.id) : [event.id])
  }
}

/**
 * Who to tell when the pointer moves onto or off a node.
 *
 * A single module-level slot rather than a per-demo callback prop: all three
 * demos already call `createHoverTrail`, and threading a fourth handler
 * through each adapter's own idiom to reach the one panel in `main.ts` would
 * be three edits to say one thing. Same shape as `setWorkingSetHook`.
 */
let hoverReporter: ((id: string | null) => void) | null = null

export function setHoverReporter(report: ((id: string | null) => void) | null): void {
  hoverReporter = report
}

function reportHover(id: string | null): void {
  hoverReporter?.(id)
}

export function createAccordionSlide(
  apiOf: () => KladApi | null | undefined,
  example: Example,
): { start: () => void; stop: () => void } {
  const SLIDE_MS = 200
  let handle: number | null = null

  const step = (): void => {
    handle = null
    let moving = false
    for (const item of example.data) {
      const target = item.detail === true ? 1 : 0
      const current = accordionProgress(item)
      if (current === target) continue
      const delta = 1000 / 60 / SLIDE_MS
      const next = target > current ? Math.min(target, current + delta) : Math.max(target, current - delta)
      item.detailT = next
      if (next !== target) moving = true
    }
    apiOf()?.refresh()
    if (moving) handle = requestAnimationFrame(step)
  }

  return {
    start: () => {
      if (handle === null) handle = requestAnimationFrame(step)
    },
    stop: () => {
      if (handle !== null) cancelAnimationFrame(handle)
      handle = null
    },
  }
}
