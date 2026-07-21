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
  | { t: 'open'; index: number; open: boolean }
  | { t: 'resize'; width: number; height: number; dpr: number }
  | { t: 'highlight'; ids: Uint32Array | null }
  | { t: 'drag'; index: number }
  | { t: 'animate'; enabled: boolean }

export type WorkerToMain =
  | { t: 'layout'; boxes: Float64Array; bounds: Bounds; visibleToSource: Int32Array }
  /** `transitioning` mirrors `ChartEngine.transitioning` at the moment this
   * frame was drawn, so the main-thread host can tell a caller whether to
   * keep scheduling frames without a worker round trip of its own. */
  | { t: 'frame'; visible: Uint32Array; transitioning: boolean }
  | { t: 'error'; message: string }
