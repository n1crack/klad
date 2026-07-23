import type { Tree } from '../tree.js'
import type { Camera } from '../viewport.js'
import type { Orientation } from '../layout/orientation.js'
import type { LodThresholds } from '../render/lod.js'
import type { Bounds } from '../types.js'

/**
 * The structural half of a `Tree` — every field is a transferable typed array.
 * `indexToId`/`idToIndex` stay on the main thread: the worker addresses nodes by
 * index and never needs a user-facing id.
 */
export interface WireTree {
  count: number
  parent: Int32Array
  childStart: Int32Array
  childIndex: Int32Array
  roots: Int32Array
  depth: Int32Array
  order: Int32Array
}

export function toWireTree(tree: Tree): WireTree {
  return {
    count: tree.count,
    parent: tree.parent,
    childStart: tree.childStart,
    childIndex: tree.childIndex,
    roots: tree.roots,
    depth: tree.depth,
    order: tree.order,
  }
}

/**
 * Rebuilds a `Tree` from wire arrays, synthesising ids. `pruneToVisible` and
 * `layout` both require a full `Tree`, and neither reads the ids.
 */
export function wireTreeToTree(wire: WireTree): Tree {
  const indexToId: string[] = Array.from({ length: wire.count })
  const idToIndex = new Map<string, number>()
  for (let i = 0; i < wire.count; i++) {
    const id = String(i)
    indexToId[i] = id
    idToIndex.set(id, i)
  }
  return {
    count: wire.count,
    indexToId,
    idToIndex,
    parent: wire.parent,
    childStart: wire.childStart,
    childIndex: wire.childIndex,
    roots: wire.roots,
    depth: wire.depth,
    order: wire.order,
    warnings: [],
  }
}

export interface EngineOptions {
  spacingX: number
  spacingY: number
  orientation: Orientation
  rtl: boolean
  lod: LodThresholds
}

/**
 * Every main-thread message, before the clock envelope below is added. Split
 * out from `MainToWorker` itself purely so `host.ts` can build a message
 * without restating the timestamp at each call site.
 */
export type MainToWorkerMessage =
  | { t: 'init'; canvas: unknown; dpr: number; width: number; height: number; theme: unknown }
  | { t: 'data'; tree: WireTree; sizes: Float64Array; labels: string[]; open: Uint8Array }
  | { t: 'options'; options: Partial<EngineOptions> }
  | { t: 'camera'; camera: Camera }
  /**
   * "Draw a frame." Carries no payload of its own — everything it needs is
   * the `now` every message carries (see `MainToWorker` below). Exists
   * because a host driving an animation has to be able to ask for a frame at
   * a specific instant without also restating some piece of state; the old
   * code re-sent a `camera` message purely as a "please draw" trigger.
   */
  | { t: 'render' }
  /** `ring` mirrors `ChartEngine.setOpen`'s third argument — see its
   * docblock in engine.ts. Sent as a definite `boolean` (never omitted)
   * because `ChartHost.setOpen` resolves the caller's optional argument to a
   * concrete value before this message is ever built, so the wire type
   * doesn't need to repeat the "defaults to true" nuance. */
  | { t: 'open'; index: number; open: boolean; ring: boolean }
  /** Arms the confirmation ring on `index` without touching open state — see
   * `ChartEngine.flashRing`. */
  | { t: 'ring'; index: number }
  | { t: 'resize'; width: number; height: number; dpr: number }
  | { t: 'highlight'; ids: Uint32Array | null }
  | { t: 'isolate'; index: number }
  | { t: 'drag'; index: number }
  | { t: 'animate'; enabled: boolean }
  /**
   * Paint-only, mirroring `Renderer.setTheme` — carries an already-resolved
   * `Theme` (never a `Partial<Theme>`; the main thread resolves it before
   * this is sent, same as `init`'s own `theme` field does). Structured-cloned
   * rather than transferred: a `Theme` is a handful of strings/numbers, not a
   * typed array, so there is nothing worth transferring here.
   */
  | { t: 'theme'; theme: unknown }

/**
 * Every message the worker receives, stamped with the MAIN THREAD's clock at
 * the moment it was sent. The worker renders after each one, and renders with
 * this timestamp — it never reads a clock of its own.
 *
 * This is not a micro-optimisation, it is a correctness requirement, for two
 * independent reasons:
 *
 *  - A dedicated Worker does NOT share the document's time origin: its
 *    `performance.now()` counts from when the WORKER was created, so it runs
 *    behind the main thread's by however long the page had been alive at that
 *    point. An engine whose transition was started from one clock and then
 *    advanced with the other doesn't drift a little; it computes a progress
 *    that is wrong by seconds and finishes the transition on the spot.
 *  - Even with a shared origin, a clock read in the worker is read when the
 *    message is DEQUEUED, not when the frame it belongs to began. That skew —
 *    postMessage latency plus whatever else is queued — varies frame to
 *    frame, so the toggle camera anchor (which solves the camera on the main
 *    thread to pin a node at where its tween puts it at `now`) would be
 *    holding the camera for time T while the canvas painted the node at
 *    T + skew: a pinned node that jitters sideways for the whole transition.
 *
 * Stamped centrally by `host.ts`'s `post`, so no call site has to remember.
 */
export type MainToWorker = MainToWorkerMessage & { now: number }

export type WorkerToMain =
  | { t: 'layout'; boxes: Float64Array; bounds: Bounds; visibleToSource: Int32Array }
  /** `transitioning`/`ringActive` mirror `ChartEngine.transitioning` /
   * `ChartEngine.ringActive` at the moment this frame was drawn, so the
   * main-thread host can tell a caller whether to keep scheduling frames
   * without a worker round trip of its own. Both are threaded through
   * separately — see `ChartEngine.ringActive`'s docblock for why the ring
   * can still need frames after the layout transition has already ended.
   *
   * `lastDrawnBoxes` mirrors `ChartEngine.lastDrawnBoxes` exactly: interpolated
   * boxes for exactly the source indices in `visible`, same order, `null`
   * whenever `transitioning` is false. Bounded by `visible.length` (the
   * near-viewport drawn set), never by total node count — this is what lets
   * the main-thread host's DOM overlay and camera anchor track the SAME
   * per-frame geometry the worker's canvas just painted, without streaming
   * the whole (potentially 50k-node) layout across the boundary every
   * frame. Transferred, not structured-cloned, when present — see
   * chart.worker.ts. */
  | {
      t: 'frame'
      visible: Uint32Array
      transitioning: boolean
      ringActive: boolean
      lastDrawnBoxes: Float64Array | null
      /** Mirrors `ChartEngine.lastDrawnAlpha` exactly: the reveal alpha for
       * exactly the source indices in `visible`, same order, `null` whenever
       * nothing on screen is fading. Bounded by `visible.length` like
       * `lastDrawnBoxes`, and transferred the same way when present — this is
       * what lets the main-thread host's DOM overlay honour the same fade the
       * worker's canvas just painted with. */
      lastDrawnAlpha: Float32Array | null
      /** Mirrors `ChartEngine.transitionStartedAt` — the origin the running
       * transition's curve is measured from, `null` when none is running. A
       * host advancing its own animation in lockstep with the transition (the
       * toggle camera anchor) has to measure from this exact value; see the
       * getter's docblock for why it cannot be inferred from the host's own
       * frame clock in worker mode. */
      transitionStartedAt: number | null
    }
  | { t: 'error'; message: string }
