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

export type MainToWorker =
  | { t: 'init'; canvas: unknown; dpr: number; width: number; height: number; theme: unknown }
  | { t: 'data'; tree: WireTree; sizes: Float64Array; labels: string[]; open: Uint8Array }
  | { t: 'options'; options: Partial<EngineOptions> }
  | { t: 'camera'; camera: Camera }
  /** `ring` mirrors `ChartEngine.setOpen`'s third argument — see its
   * docblock in engine.ts. Sent as a definite `boolean` (never omitted)
   * because `ChartHost.setOpen` resolves the caller's optional argument to a
   * concrete value before this message is ever built, so the wire type
   * doesn't need to repeat the "defaults to true" nuance. */
  | { t: 'open'; index: number; open: boolean; ring: boolean }
  | { t: 'resize'; width: number; height: number; dpr: number }
  | { t: 'highlight'; ids: Uint32Array | null }
  | { t: 'drag'; index: number }
  | { t: 'animate'; enabled: boolean }

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
    }
  | { t: 'error'; message: string }
