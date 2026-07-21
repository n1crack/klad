import type { Bounds } from './types.js'
import type { Camera } from './viewport.js'
import type { Renderer } from './render/renderer.js'
import type { EngineOptions, WireTree } from './worker/protocol.js'
import { wireTreeToTree } from './worker/protocol.js'
import { pruneToVisible } from './visible.js'
import { layout } from './layout/tidy.js'
import { applyOrientation } from './layout/orientation.js'
import { buildQuadTree, type QuadTree } from './spatial/quadtree.js'
import { visibleRect } from './viewport.js'
import { DEFAULT_LOD, lodFor } from './render/lod.js'
import type { Tree } from './tree.js'

export interface ChartEngine {
  setData(tree: WireTree, sizes: Float64Array, labels: string[], open: Uint8Array): void
  setOptions(partial: Partial<EngineOptions>): void
  setOpen(index: number, open: boolean): void
  setCamera(camera: Camera): void
  setViewport(width: number, height: number, dpr: number): void
  setHighlight(sourceIds: Uint32Array | null): void
  setDrag(sourceIndex: number): void
  /** Draws a frame and returns the SOURCE indices currently on screen. */
  render(): Uint32Array
  /** Boxes in the pruned index space. */
  readonly boxes: Float64Array
  readonly bounds: Bounds
  /** Pruned index -> source index. */
  readonly visibleToSource: Int32Array
  /** World-space hit test; returns a SOURCE index or -1. */
  hitTest(worldX: number, worldY: number): number
}

const DEFAULT_OPTIONS: EngineOptions = {
  spacingX: 16,
  spacingY: 48,
  orientation: 'tb',
  rtl: false,
  lod: DEFAULT_LOD,
}

const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

/** Frozen empty label list, reused instead of allocating `[]` every `block`-tier frame. */
const NO_LABELS: readonly string[] = []

/**
 * Partitions `buf[0, count)` in place so entries whose own box overlaps
 * `rect` come first. Returns the count of those genuinely-visible entries;
 * `[return value, count)` holds the rest — captured only by a wider margin
 * query, still needed so their connector to a visible ancestor draws, but not
 * eligible for their own fill/stroke/label.
 *
 * Swap-based (Lomuto-style) partition, O(count), no allocation, and no
 * ordering guarantee within either half — nothing downstream (edge batching,
 * node fill/stroke, label draw) depends on draw order.
 */
function partitionVisible(buf: Uint32Array, count: number, boxes: Float64Array, rect: Bounds): number {
  let lo = 0
  for (let i = 0; i < count; i++) {
    const idx = buf[i]!
    const o = idx * 4
    const x0 = boxes[o]!
    const y0 = boxes[o + 1]!
    // Same half-open overlap test as quadtree.ts's `overlaps` — must agree
    // with it, since this re-tests entries that query already selected
    // against the (wider) margin rect, now against the true viewport rect.
    const overlaps =
      x0 < rect.maxX && x0 + boxes[o + 2]! > rect.minX && y0 < rect.maxY && y0 + boxes[o + 3]! > rect.minY
    if (overlaps) {
      if (i !== lo) {
        const tmp = buf[lo]!
        buf[lo] = buf[i]!
        buf[i] = tmp
      }
      lo++
    }
  }
  return lo
}

/**
 * Owns all mutable chart state. Deliberately free of any transport concern: the
 * worker entry wraps it, and the main-thread fallback drives the identical
 * object, so the two paths cannot drift apart.
 *
 * Layout runs only when data, options, or open state change. A camera move
 * re-culls and redraws but never re-lays-out — that separation is what keeps a
 * 50k chart at 60fps.
 */
export function createChartEngine(renderer: Renderer): ChartEngine {
  let sourceTree: Tree = wireTreeToTree({
    count: 0,
    parent: new Int32Array(0),
    childStart: new Int32Array(1),
    childIndex: new Int32Array(0),
    roots: new Int32Array(0),
    depth: new Int32Array(0),
    order: new Int32Array(0),
  })
  let sourceSizes: Float64Array = new Float64Array(0)
  let sourceLabels: string[] = []
  let open: Uint8Array = new Uint8Array(0)
  let options: EngineOptions = { ...DEFAULT_OPTIONS }

  let boxes: Float64Array = new Float64Array(0)
  // Copy, not the module singleton itself — EMPTY_BOUNDS has no readonly fields,
  // and every engine returning the same object would let one engine's mutation
  // (or a caller's) corrupt every other engine's `bounds` before the first relayout.
  let bounds: Bounds = { ...EMPTY_BOUNDS }
  let visibleToSource: Int32Array = new Int32Array(0)
  let prunedParent: Int32Array = new Int32Array(0)
  let prunedLabels: string[] = []
  let quad: QuadTree | null = null

  let camera: Camera = { x: 0, y: 0, k: 1 }
  let viewport = { width: 0, height: 0, dpr: 1 }
  let highlightSource: Uint32Array | null = null
  let dragSource = -1

  let layoutDirty = true
  // Reused across frames and grown, never shrunk. After a relayout collapses the
  // visible set, entries at and beyond the current `visibleCount` are stale —
  // possibly out of range for the new (smaller) `boxes` — but that is safe only
  // because `Frame.visible`'s contract is "read the first `visibleCount` entries
  // and no more." Do not read past `visibleCount`, and do not add a fill here:
  // it would cost real time every frame for a tail nothing is allowed to see.
  let cullBuffer = new Uint32Array(0)
  let highlightBuffer: Uint8Array | null = null

  /**
   * How far past the viewport, along the tree's growth axis (vertical for
   * tb/bt, horizontal for lr/rl), a node can be while a connector it's part
   * of might still cross the viewport. Recomputed on every relayout;
   * defended below.
   *
   * From tidy.ts's own y[i] formula, `y[child] = y[parent] + height(parent)
   * + spacingY`, so a direct parent/child pair's near edges (parent's
   * bottom, child's top) are *exactly* `spacingY` apart in layout space —
   * independent of either node's size. `applyOrientation` only transposes
   * and mirrors (see its docblock), never scales, so that distance survives
   * unchanged into world units for every orientation.
   *
   * That alone would be enough if "visible" meant "fully inside the
   * viewport" — but it means "overlaps it at all". A node can overlap the
   * viewport by a single pixel while the rest of its own box (and, chained
   * from that, its child's near edge) extends far beyond the viewport edge,
   * up to that node's own extent along the growth axis. `maxGrowthExtent`
   * bounds that per-node worst case; adding it to `spacingY` bounds the
   * combined case. Both terms are per-node/per-level geometry the engine
   * already has on hand during relayout, not a guessed constant, and neither
   * scales with total node count — so the margin (and the widened query it
   * drives in `render()`) stays bounded by "what's near the viewport",
   * exactly like the unwidened query already was.
   */
  let cullMargin = 0

  const relayout = (): void => {
    const pruned = pruneToVisible(sourceTree, open)
    visibleToSource = pruned.toSource
    prunedParent = pruned.tree.parent

    const n = pruned.tree.count
    const sizes = new Float64Array(n * 2)
    prunedLabels = Array.from({ length: n })

    // For lr/rl the tree grows along x, so the layout — which always works in a
    // top-down space — must be told each node's extent along that growth axis. Feed
    // it width and height swapped; `applyOrientation`'s transpose then swaps them
    // back, leaving a card the shape the caller asked for rather than a rotated one.
    const horizontal = options.orientation === 'lr' || options.orientation === 'rl'

    // Largest single node's extent along the growth axis (post-swap `height`,
    // i.e. what becomes vertical for tb/bt or horizontal-after-transpose for
    // lr/rl) — folded into the same O(n) pass that already visits every
    // pruned node, so this costs nothing extra. Feeds `cullMargin` below.
    let maxGrowthExtent = 0

    for (let i = 0; i < n; i++) {
      const src = visibleToSource[i]!
      const w = sourceSizes[src * 2] ?? 0
      const h = sourceSizes[src * 2 + 1] ?? 0
      const growthExtent = horizontal ? w : h
      sizes[i * 2] = horizontal ? h : w
      sizes[i * 2 + 1] = growthExtent
      if (growthExtent > maxGrowthExtent) maxGrowthExtent = growthExtent
      prunedLabels[i] = sourceLabels[src] ?? ''
    }

    const growthSpacing = horizontal ? options.spacingX : options.spacingY
    const result = layout(pruned.tree, sizes, {
      spacingX: horizontal ? options.spacingY : options.spacingX,
      spacingY: growthSpacing,
    })
    boxes = result.boxes
    bounds = applyOrientation(boxes, result.bounds, options.orientation, options.rtl)
    quad = buildQuadTree(boxes, bounds)
    cullMargin = maxGrowthExtent + growthSpacing

    if (cullBuffer.length < n) cullBuffer = new Uint32Array(n)
    layoutDirty = false
  }

  const render = (): Uint32Array => {
    if (layoutDirty) relayout()

    const n = visibleToSource.length
    // `edgeCount` (the query result, using the margin-widened rect) drives
    // connector drawing; `nodeCount` (the true-visible subset, using the
    // exact viewport rect) drives node fill/stroke/label drawing and is what
    // `render()` reports as "on screen". See `cullMargin`'s docblock for why
    // widening only the growth axis is both necessary and sufficient.
    let edgeCount = 0
    let nodeCount = 0
    if (n > 0 && quad !== null && viewport.width > 0 && viewport.height > 0) {
      const rect = visibleRect(camera, { width: viewport.width, height: viewport.height })
      const horizontal = options.orientation === 'lr' || options.orientation === 'rl'
      const queryRect: Bounds = horizontal
        ? { minX: rect.minX - cullMargin, minY: rect.minY, maxX: rect.maxX + cullMargin, maxY: rect.maxY }
        : { minX: rect.minX, minY: rect.minY - cullMargin, maxX: rect.maxX, maxY: rect.maxY + cullMargin }
      edgeCount = quad.query(queryRect, cullBuffer)
      nodeCount = partitionVisible(cullBuffer, edgeCount, boxes, rect)
    }

    if (highlightSource === null) {
      highlightBuffer = null
    } else {
      if (highlightBuffer === null || highlightBuffer.length < n) highlightBuffer = new Uint8Array(n)
      else highlightBuffer.fill(0)
      // highlightSource holds SOURCE indices; translate into pruned space.
      for (const src of highlightSource) {
        for (let i = 0; i < n; i++) {
          if (visibleToSource[i] === src) {
            highlightBuffer[i] = 1
            break
          }
        }
      }
    }

    let dragPruned = -1
    if (dragSource !== -1) {
      for (let i = 0; i < n; i++) {
        if (visibleToSource[i] === dragSource) {
          dragPruned = i
          break
        }
      }
    }

    const tier = lodFor(camera.k, options.lod)
    renderer.draw({
      boxes,
      parent: prunedParent,
      visible: cullBuffer,
      visibleCount: nodeCount,
      edgeCount,
      labels: tier === 'block' ? NO_LABELS : prunedLabels,
      camera,
      dpr: viewport.dpr,
      tier,
      horizontal: options.orientation === 'lr' || options.orientation === 'rl',
      highlight: highlightBuffer,
      dragIndex: dragPruned,
    })

    // Reports only the genuinely on-screen set (see the `ChartEngine.render`
    // docblock) — `edgeCount`'s margin-only tail is an implementation detail
    // of connector drawing, not something a host should see as "visible".
    const drawn = new Uint32Array(nodeCount)
    for (let i = 0; i < nodeCount; i++) drawn[i] = visibleToSource[cullBuffer[i]!]!
    return drawn
  }

  return {
    setData(tree, sizes, labels, openFlags) {
      sourceTree = wireTreeToTree(tree)
      // Defensive-copy every caller-owned buffer. In the worker path these
      // arrive as structured clones the engine already owns, but the
      // main-thread fallback hands over the host's live arrays — aliasing
      // them would let a later host-side mutation (or an engine write, in
      // `setOpen`'s case) silently reach through into the caller, and the
      // worker/main-thread paths would disagree about when a change lands.
      sourceSizes = Float64Array.from(sizes)
      sourceLabels = [...labels]
      // Size the copy to the tree, not to whatever length the caller passed:
      // zero-extend a short `open` (Uint8Array defaults new slots to 0 —
      // "closed", so a chart degrades to its roots instead of reading
      // `undefined` out of bounds) and ignore a long one's tail.
      const n = sourceTree.count
      const nextOpen = new Uint8Array(n)
      nextOpen.set(openFlags.subarray(0, Math.min(openFlags.length, n)))
      open = nextOpen
      // Highlight and drag hold SOURCE indices, meaningless against a new
      // dataset. A host that wants highlight to survive a refresh must
      // re-issue setHighlight against the new indices.
      highlightSource = null
      highlightBuffer = null
      dragSource = -1
      layoutDirty = true
    },
    setOptions(partial) {
      const next = { ...options, ...partial }
      // `lod` only feeds `lodFor` in `render()` — it has no influence on
      // pruneToVisible/layout/applyOrientation/buildQuadTree, so it must not
      // dirty the layout. Only these keys actually change relayout output.
      if (
        next.spacingX !== options.spacingX ||
        next.spacingY !== options.spacingY ||
        next.orientation !== options.orientation ||
        next.rtl !== options.rtl
      ) {
        layoutDirty = true
      }
      options = next
    },
    setOpen(index, value) {
      if (index < 0 || index >= open.length) return
      const v = value ? 1 : 0
      if (open[index] === v) return
      open[index] = v
      layoutDirty = true
    },
    setCamera(next) {
      // Called every frame; keep this a plain spread of three numbers so it
      // stays a cheap, allocation-bounded copy. Aliasing the caller's object
      // would let a main-thread host mutate `camera.k` after the fact and
      // silently flip the LOD tier on the next render with no setCamera call.
      camera = { x: next.x, y: next.y, k: next.k }
    },
    setViewport(width, height, dpr) {
      viewport = { width, height, dpr }
      renderer.resize(width, height, dpr)
    },
    setHighlight(ids) {
      highlightSource = ids
    },
    setDrag(index) {
      dragSource = index
    },
    render,
    get boxes() {
      return boxes
    },
    get bounds() {
      return bounds
    },
    get visibleToSource() {
      return visibleToSource
    },
    hitTest(worldX, worldY) {
      if (layoutDirty) relayout()
      if (quad === null) return -1
      const pruned = quad.hitTest(worldX, worldY)
      return pruned === -1 ? -1 : visibleToSource[pruned]!
    },
  }
}
