import type { Bounds } from './types.js'
import type { Camera } from './viewport.js'
import type { Renderer } from './render/renderer.js'
import type { EngineOptions, WireTree } from './worker/protocol.js'
import { wireTreeToTree } from './worker/protocol.js'
import { pruneToVisible } from './visible.js'
import { layout } from './layout/tidy.js'
import { applyOrientation } from './layout/orientation.js'
import { buildQuadTree, type QuadTree } from './spatial/quadtree.js'
import { visibleRect, easeOutCubic } from './viewport.js'
import { DEFAULT_LOD, lodFor } from './render/lod.js'
import type { Tree } from './tree.js'

// `performance.now()` is available in browsers, Web Workers, and Node (this
// engine runs in all three), but this package's tsconfig sets `types: []`
// and `lib: ["ES2023"]` to keep DOM/Node leakage out of runtime code, so TS
// doesn't know about it. A bare module-scoped `declare const` — never
// `declare global` — resolves to the host global at runtime without leaking
// the name into any other module in this package.
declare const performance: { now(): number }

export interface ChartEngine {
  setData(tree: WireTree, sizes: Float64Array, labels: string[], open: Uint8Array): void
  setOptions(partial: Partial<EngineOptions>): void
  setOpen(index: number, open: boolean): void
  setCamera(camera: Camera): void
  setViewport(width: number, height: number, dpr: number): void
  setHighlight(sourceIds: Uint32Array | null): void
  setDrag(sourceIndex: number): void
  /**
   * Enables or disables the expand/collapse layout transition. Disabling
   * mid-transition snaps straight to the final layout — for a host honouring
   * `prefers-reduced-motion` or an explicit `animate: false`.
   */
  setAnimate(enabled: boolean): void
  /**
   * Draws a frame and returns the SOURCE indices currently on screen. `now`
   * is a timestamp in the same units/epoch as the caller's clock (e.g. a
   * `requestAnimationFrame` timestamp) — the caller drives time, exactly like
   * `viewport.ts`'s `interpolate`; this defaults to `performance.now()` for
   * callers that don't care (transitions are off, or the caller has no
   * better clock at hand).
   */
  render(now?: number): Uint32Array
  /** True while an expand/collapse transition is still in progress. */
  readonly transitioning: boolean
  /** Boxes in the pruned index space. Always the FINAL layout, never an
   * in-progress transition's interpolated positions — hit-testing and any
   * other consumer of this getter must not chase a moving target. */
  readonly boxes: Float64Array
  readonly bounds: Bounds
  /** Pruned index -> source index. */
  readonly visibleToSource: Int32Array
  /** World-space hit test; returns a SOURCE index or -1. Always resolves
   * against the final layout, even mid-transition. */
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

// ---------------------------------------------------------------------------
// Expand/collapse layout transition.
//
// A toggle produces a new layout in a new pruned index space — the old one is
// simply discarded today. To animate, the old layout is kept just long enough
// to interpolate from, then dropped. Three kinds of node exist during a
// transition:
//  - present before and after: tween old box -> new box.
//  - newly revealed (an expand): "from" is the nearest ancestor's position at
//    the moment of the toggle, so it reads as emerging from the node that
//    was opened.
//  - removed (a collapse): gone from the new pruned tree entirely, so they
//    can't ride along in the normal per-node arrays. Carried separately as
//    "ghosts" that keep drawing (shrinking/fading toward the ancestor that
//    swallowed them) until the transition ends.
//
// Caller-drives-time discipline throughout, same as viewport.ts's
// `interpolate`: nothing here reads a clock. `render(now)` receives `now`
// from its caller and everything below is a pure function of it.
// ---------------------------------------------------------------------------

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function boxAt(boxes: Float64Array, i: number): Box {
  const o = i * 4
  return { x: boxes[o]!, y: boxes[o + 1]!, w: boxes[o + 2]!, h: boxes[o + 3]! }
}

function writeBox(target: Float64Array, i: number, box: Box): void {
  const o = i * 4
  target[o] = box.x
  target[o + 1] = box.y
  target[o + 2] = box.w
  target[o + 3] = box.h
}

function lerpBox(from: Box, to: Box, t: number): Box {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    w: from.w + (to.w - from.w) * t,
    h: from.h + (to.h - from.h) * t,
  }
}

/** Roughly 250ms reads as a settling reveal without feeling sluggish on a
 * repeated expand/collapse; not exposed as a knob (yet) since nothing has
 * asked for a different pace. */
const TRANSITION_DURATION_MS = 250

interface TweenEntry {
  box: Box
  /** True for a node newly revealed by this transition (no prior position of
   * its own) — drives the fade-in; false for a node that already existed and
   * is merely moving. */
  revealed: boolean
}

interface Ghost {
  /** SOURCE index — ghosts have no pruned index in the new tree. */
  source: number
  from: Box
  to: Box
}

interface Transition {
  startedAt: number
  duration: number
  /** Keyed by SOURCE index (stable across a toggle, unlike a pruned index). */
  fromBySource: Map<number, TweenEntry>
  ghosts: Ghost[]
  /** Built once over each ghost's from/to union box; queried every frame like
   * the main quadtree, so a huge collapsed subtree only costs at cull time
   * for the ghosts actually near the viewport. */
  ghostQuad: QuadTree | null
}

function progressOf(t: Transition, now: number): number {
  if (t.duration <= 0) return 1
  const raw = (now - t.startedAt) / t.duration
  return raw <= 0 ? 0 : raw >= 1 ? 1 : raw
}

/**
 * Builds the transition that starts as `relayout()` replaces the current
 * layout with a new one. All arguments describing the "old" side are the
 * state from just before that replacement; the "new" side is what relayout
 * just produced.
 *
 * Cost is O(old pruned count + new pruned count), paid once per toggle, not
 * per frame — the same class of one-time cost `relayout()` itself already
 * pays. `render()`'s per-frame use of the result only ever touches what's
 * near the viewport; see its `applyTween`/ghost-query loops.
 */
function buildTransition(
  now: number,
  prevBoxes: Float64Array,
  prevVisibleToSource: Int32Array,
  prevParent: Int32Array,
  prevTransition: Transition | null,
  boxes: Float64Array,
  visibleToSource: Int32Array,
  prunedParent: Int32Array,
  prunedFromSource: Int32Array,
): Transition {
  // 1. Wherever every old-layout node (and any still-fading ghost) visually
  // is RIGHT NOW, not where it started or where it will settle — this is
  // what makes a second toggle mid-flight retarget instead of snapping.
  const prevPositionBySource = new Map<number, Box>()
  const prevEased = prevTransition === null ? 1 : easeOutCubic(progressOf(prevTransition, now))
  for (let i = 0; i < prevVisibleToSource.length; i++) {
    const src = prevVisibleToSource[i]!
    let box = boxAt(prevBoxes, i)
    if (prevTransition !== null) {
      const entry = prevTransition.fromBySource.get(src)
      if (entry !== undefined) box = lerpBox(entry.box, box, prevEased)
    }
    prevPositionBySource.set(src, box)
  }
  if (prevTransition !== null) {
    for (const ghost of prevTransition.ghosts) {
      if (!prevPositionBySource.has(ghost.source)) {
        prevPositionBySource.set(ghost.source, lerpBox(ghost.from, ghost.to, prevEased))
      }
    }
  }

  // 2. Surviving (tweened) and newly-revealed nodes. `resolveReveal` walks
  // the NEW tree's parent chain looking for the nearest ancestor with a
  // prior position, memoizing every pruned index it passes through so a
  // multi-level reveal (expanding a grandparent) costs O(1) amortized per
  // node instead of O(depth) per node.
  const fromBySource = new Map<number, TweenEntry>()
  const revealCache = new Map<number, Box>()
  const resolveReveal = (i: number): Box => {
    const cached = revealCache.get(i)
    if (cached !== undefined) return cached
    const path: number[] = []
    let p = prunedParent[i]!
    let result: Box | null = null
    while (p !== -1) {
      const viaCache = revealCache.get(p)
      if (viaCache !== undefined) {
        result = viaCache
        break
      }
      const psrc = visibleToSource[p]!
      const prev = prevPositionBySource.get(psrc)
      if (prev !== undefined) {
        result = prev
        break
      }
      path.push(p)
      p = prunedParent[p]!
    }
    const box = result ?? boxAt(boxes, i)
    for (const idx of path) revealCache.set(idx, box)
    revealCache.set(i, box)
    return box
  }

  for (let i = 0; i < visibleToSource.length; i++) {
    const src = visibleToSource[i]!
    const prev = prevPositionBySource.get(src)
    if (prev !== undefined) fromBySource.set(src, { box: prev, revealed: false })
    else fromBySource.set(src, { box: resolveReveal(i), revealed: true })
  }

  // 3. Removed nodes become ghosts, collapsing toward the nearest ancestor
  // that survived into the new tree. `resolveAncestor` walks the OLD tree's
  // parent chain (the new tree has no entry for a removed node to walk
  // from) with the same memoization trick as `resolveReveal`.
  const ghosts: Ghost[] = []
  const ancestorCache = new Map<number, Box | null>()
  const resolveAncestor = (oldIdx: number): Box | null => {
    const path: number[] = []
    let idx = prevParent[oldIdx]!
    let result: Box | null = null
    while (idx !== -1) {
      const src = prevVisibleToSource[idx]!
      const cached = ancestorCache.get(src)
      if (cached !== undefined) {
        result = cached
        break
      }
      const newIdx = prunedFromSource[src]!
      if (newIdx !== -1) {
        result = boxAt(boxes, newIdx)
        break
      }
      path.push(idx)
      idx = prevParent[idx]!
    }
    for (const idx2 of path) ancestorCache.set(prevVisibleToSource[idx2]!, result)
    return result
  }

  for (let i = 0; i < prevVisibleToSource.length; i++) {
    const src = prevVisibleToSource[i]!
    if (prunedFromSource[src] !== -1) continue // survives into the new tree
    const from = prevPositionBySource.get(src)!
    ghosts.push({ source: src, from, to: resolveAncestor(i) ?? from })
  }
  // Ghosts already mid-fade from a PRIOR transition, still absent from the
  // new tree, keep fading from wherever they currently are — their source is
  // never also in `prevVisibleToSource` (a node is either still pruned-tree
  // or already a ghost, never both), so this cannot double-add one.
  if (prevTransition !== null) {
    for (const ghost of prevTransition.ghosts) {
      if (prunedFromSource[ghost.source] !== -1) continue // reappeared; handled as a reveal above
      const from = prevPositionBySource.get(ghost.source)!
      ghosts.push({ source: ghost.source, from, to: ghost.to })
    }
  }

  let ghostQuad: QuadTree | null = null
  if (ghosts.length > 0) {
    const unionBoxes = new Float64Array(ghosts.length * 4)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let g = 0; g < ghosts.length; g++) {
      const ghost = ghosts[g]!
      const x0 = Math.min(ghost.from.x, ghost.to.x)
      const y0 = Math.min(ghost.from.y, ghost.to.y)
      const x1 = Math.max(ghost.from.x + ghost.from.w, ghost.to.x + ghost.to.w)
      const y1 = Math.max(ghost.from.y + ghost.from.h, ghost.to.y + ghost.to.h)
      unionBoxes[g * 4] = x0
      unionBoxes[g * 4 + 1] = y0
      unionBoxes[g * 4 + 2] = x1 - x0
      unionBoxes[g * 4 + 3] = y1 - y0
      if (x0 < minX) minX = x0
      if (y0 < minY) minY = y0
      if (x1 > maxX) maxX = x1
      if (y1 > maxY) maxY = y1
    }
    ghostQuad = buildQuadTree(unionBoxes, { minX, minY, maxX, maxY })
  }

  return { startedAt: now, duration: TRANSITION_DURATION_MS, fromBySource, ghosts, ghostQuad }
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
  /** SOURCE index -> pruned index, or -1. Same shape as `VisibleTree.fromSource`;
   * kept so the transition machinery can check "does this source survive into
   * the new tree" in O(1) instead of building its own reverse map. */
  let prunedFromSource: Int32Array = new Int32Array(0)
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

  // --- expand/collapse transition state ---
  let animate = false
  // Set by `setOpen` when it actually flips a flag; consumed (and reset) by
  // the next `relayout()`. `setData`/`setOptions`-triggered relayouts leave
  // this false, so loading a new dataset or changing spacing/orientation
  // still snaps instantly — only a toggle animates.
  let pendingTransition = false
  let transition: Transition | null = null
  // The boxes actually handed to the renderer. Aliases `boxes` (zero extra
  // cost) whenever no transition is running; a real mutable copy, selectively
  // overwritten per frame for only the near-viewport entries, while one is.
  let renderBoxes: Float64Array = new Float64Array(0)
  let ghostCullBuffer = new Uint32Array(0)
  let ghostDrawBoxes = new Float64Array(0)
  let ghostDrawAlpha = new Float32Array(0)
  let revealAlphaBuffer = new Float32Array(0)

  const relayout = (now: number): void => {
    const prevBoxes = boxes
    const prevVisibleToSource = visibleToSource
    const prevParent = prunedParent
    const prevTransition = transition

    const pruned = pruneToVisible(sourceTree, open)
    visibleToSource = pruned.toSource
    prunedParent = pruned.tree.parent
    prunedFromSource = pruned.fromSource

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

    // Start (or continue) a transition only for a toggle-triggered relayout,
    // only when animation is enabled, and only when there was a previous
    // layout to transition from (the very first layout has nothing to tween).
    if (animate && pendingTransition && prevVisibleToSource.length > 0) {
      transition = buildTransition(
        now,
        prevBoxes,
        prevVisibleToSource,
        prevParent,
        prevTransition,
        boxes,
        visibleToSource,
        prunedParent,
        prunedFromSource,
      )
      renderBoxes = boxes.slice()
    } else {
      transition = null
      renderBoxes = boxes
    }
    pendingTransition = false

    layoutDirty = false
  }

  const render = (now: number = performance.now()): Uint32Array => {
    if (layoutDirty) relayout(now)

    const n = visibleToSource.length
    // `edgeCount` (the query result, using the margin-widened rect) drives
    // connector drawing; `nodeCount` (the true-visible subset, using the
    // exact viewport rect) drives node fill/stroke/label drawing and is what
    // `render()` reports as "on screen". See `cullMargin`'s docblock for why
    // widening only the growth axis is both necessary and sufficient.
    //
    // Both are computed against the FINAL layout (`boxes`), never an
    // in-progress transition's interpolated positions — deliberately: a node
    // sliding into or out of the viewport only because of the transition
    // itself (as opposed to already being near it in the final layout) is a
    // known, accepted gap, not something this cull is trying to solve. See
    // the transition block below for what IS covered (the near-viewport
    // case, which is what a real toggle produces almost all the time).
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

    // --- expand/collapse transition ---
    // Cost here is bounded by `edgeCount` (near-viewport nodes) and by
    // however many ghosts the ghost-quadtree query returns (near-viewport
    // ghosts) — never by total node count, matching the 50k budget.
    let ghostCount = 0
    let revealAlpha: Float32Array | null = null
    if (transition !== null) {
      const progress = progressOf(transition, now)
      if (progress >= 1) {
        // Done: fall back to the zero-overhead steady state.
        transition = null
        renderBoxes = boxes
      } else {
        const eased = easeOutCubic(progress)

        const applyTween = (idx: number): void => {
          const entry = transition!.fromBySource.get(visibleToSource[idx]!)
          if (entry === undefined) return
          writeBox(renderBoxes, idx, lerpBox(entry.box, boxAt(boxes, idx), eased))
        }
        for (let s = 0; s < edgeCount; s++) {
          const idx = cullBuffer[s]!
          applyTween(idx)
          const par = prunedParent[idx]!
          if (par !== -1) applyTween(par)
        }

        if (nodeCount > 0) {
          if (revealAlphaBuffer.length < nodeCount) revealAlphaBuffer = new Float32Array(nodeCount)
          let anyRevealed = false
          for (let s = 0; s < nodeCount; s++) {
            const entry = transition.fromBySource.get(visibleToSource[cullBuffer[s]!]!)
            if (entry !== undefined && entry.revealed) {
              revealAlphaBuffer[s] = eased
              anyRevealed = true
            } else {
              revealAlphaBuffer[s] = 1
            }
          }
          if (anyRevealed) revealAlpha = revealAlphaBuffer
        }

        if (transition.ghostQuad !== null && viewport.width > 0 && viewport.height > 0) {
          const rect = visibleRect(camera, { width: viewport.width, height: viewport.height })
          const horizontal = options.orientation === 'lr' || options.orientation === 'rl'
          const ghostQueryRect: Bounds = horizontal
            ? { minX: rect.minX - cullMargin, minY: rect.minY, maxX: rect.maxX + cullMargin, maxY: rect.maxY }
            : { minX: rect.minX, minY: rect.minY - cullMargin, maxX: rect.maxX, maxY: rect.maxY + cullMargin }
          const total = transition.ghosts.length
          if (ghostCullBuffer.length < total) ghostCullBuffer = new Uint32Array(total)
          const gcount = transition.ghostQuad.query(ghostQueryRect, ghostCullBuffer)
          if (ghostDrawBoxes.length < gcount * 4) ghostDrawBoxes = new Float64Array(gcount * 4)
          if (ghostDrawAlpha.length < gcount) ghostDrawAlpha = new Float32Array(gcount)
          for (let g = 0; g < gcount; g++) {
            const ghost = transition.ghosts[ghostCullBuffer[g]!]!
            writeBox(ghostDrawBoxes, g, lerpBox(ghost.from, ghost.to, eased))
            ghostDrawAlpha[g] = 1 - eased
          }
          ghostCount = gcount
        }
      }
    }
    // --- end transition ---

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
      boxes: renderBoxes,
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
      revealAlpha,
      ghostBoxes: ghostDrawBoxes,
      ghostAlpha: ghostDrawAlpha,
      ghostCount,
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
      // A brand-new dataset's source indices share no meaning with the old
      // one's — tweening against them would blend unrelated nodes' positions
      // together. Drop any in-flight transition immediately (not just skip
      // starting a new one) so nothing keeps drawing a ghost from data that
      // no longer exists.
      pendingTransition = false
      transition = null
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
      pendingTransition = true
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
    setAnimate(enabled) {
      animate = enabled
      if (!enabled) {
        // Disabling mid-transition skips straight to the final layout,
        // per the brief — no lingering ghosts or half-tweened positions.
        transition = null
        renderBoxes = boxes
      }
    },
    render,
    get transitioning() {
      return transition !== null
    },
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
      // No caller-supplied clock here (the interface takes no `now`), and
      // hit-testing never needs one: it always resolves against the FINAL
      // layout (`quad`/`boxes`), never an in-progress transition's
      // interpolated positions. `performance.now()` only matters here as a
      // transition's `startedAt` reference in the rare case a toggle's
      // relayout is triggered by a hit-test rather than a render.
      if (layoutDirty) relayout(performance.now())
      if (quad === null) return -1
      const pruned = quad.hitTest(worldX, worldY)
      return pruned === -1 ? -1 : visibleToSource[pruned]!
    },
  }
}
