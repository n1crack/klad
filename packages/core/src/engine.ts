import type { Bounds } from './types.js'
import type { Camera } from './viewport.js'
import type { Renderer } from './render/renderer.js'
import type { ExportData } from './render/svg.js'
import type { EngineOptions, WireTree } from './worker/protocol.js'
import { wireTreeToTree } from './worker/protocol.js'
import { pruneToVisible } from './visible.js'
import { layout } from './layout/tidy.js'
import { applyOrientation } from './layout/orientation.js'
import { buildQuadTree, type QuadTree } from './spatial/quadtree.js'
import { visibleRect, easeOutCubic, easeInOutCubic } from './viewport.js'
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
  /**
   * `ring` says whether THIS toggle should arm the one-shot confirmation
   * ring for `index` — see `RingFlash` and `relayout`'s ring-resolution
   * block. Defaults to `true`: a lone `setOpen` call is, by far, the common
   * case (a single-node expand/collapse), and that is exactly what should
   * flash. A caller doing anything else — a deep toggle's descendant calls,
   * or an `expandAll`/`collapseAll` burst — must say so explicitly by
   * passing `false`; the engine no longer tries to infer bulk-vs-single from
   * how many distinct indices get toggled before the next relayout (see the
   * removed heuristic this replaced, in `decisions-to-revisit.md`), because
   * that heuristic couldn't tell a bulk operation apart from a single DEEP
   * toggle — both touch many distinct indices before a relayout consumes
   * them. The caller always knows which case it's in; the engine no longer
   * has to guess.
   */
  setOpen(index: number, open: boolean, ring?: boolean): void
  /**
   * Arms the one-shot confirmation ring on `index` WITHOUT a toggle — the
   * "you have arrived" half of a host's go-to-node command, where nothing
   * about the tree's open state necessarily changed (the node may well have
   * been visible all along).
   *
   * Same one-at-a-time cap as `setOpen`'s ring: a second call before the
   * next frame replaces the candidate rather than queueing a second flash.
   * Ignored when animation is off, exactly like the toggle ring, since a
   * reduced-motion host asked for no flashes.
   */
  flashRing(index: number): void
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
  /**
   * The timestamp the running transition was started from — the `now` the
   * relayout that built it was given — or `null` when none is running.
   *
   * Exists for a host that has to advance something of its own ALONGSIDE the
   * transition, in lockstep with it: the vanilla layer's toggle camera anchor
   * replays this exact transition's reposition curve (see
   * `transitionAnchorProgress`) to hold the toggled node still on screen, and
   * that only cancels out if both are evaluated against the same origin.
   *
   * A host cannot reliably infer that origin. On the in-process path the
   * relayout happens inside the first `render(now)` after the toggle, so the
   * frame time is right; in worker mode the `open` message relayouts as soon
   * as it is DEQUEUED, which is when the click happened, up to a frame before
   * the host's next `requestAnimationFrame` timestamp. A host assuming the
   * latter runs its own curve up to ~16ms behind the engine's — small, but it
   * is a phase error on a curve, so it reads as the pinned node sliding out
   * and back rather than as a constant offset.
   */
  readonly transitionStartedAt: number | null
  /**
   * True while the one-shot toggle ring is still fading. Deliberately a
   * SEPARATE flag from `transitioning`: `RING_DURATION_MS` (900ms) outlives
   * `TRANSITION_DURATION_MS` (450ms) on purpose (see `RING_DURATION_MS`'s
   * docblock), so the layout transition can finish while the ring still has
   * fading left to do. A caller that only keeps requesting frames while
   * `transitioning` is true — as the vanilla layer's `scheduleFrame` used to
   * — stops asking for frames the moment the transition ends and freezes the
   * ring wherever its alpha happened to be at that instant, which reads as
   * "it doesn't fade" rather than a completed animation. A caller driving its
   * own frame loop off `ChartEngine`/`ChartHost` must keep scheduling while
   * EITHER this or `transitioning` is true.
   */
  readonly ringActive: boolean
  /** Boxes in the pruned index space. Always the FINAL layout, never an
   * in-progress transition's interpolated positions — hit-testing and any
   * other consumer of this getter must not chase a moving target. */
  readonly boxes: Float64Array
  /**
   * Boxes in the pruned index space for THIS FRAME: interpolated while an
   * expand/collapse transition is running, the exact same array as `boxes`
   * otherwise (so a caller can always read this instead of `boxes` and get
   * identical values outside a transition, at zero extra cost). This is the
   * geometry `render()` actually painted the canvas with — what a DOM
   * overlay or a camera anchor should track, so it moves in lockstep with
   * what's on screen rather than snapping to where the layout will settle.
   *
   * Only entries for nodes `render()` actually drew this frame (near-
   * viewport, per its own cull) — plus their parents, for connector
   * endpoints — are guaranteed fresh; see `render()`'s tween loop. Every
   * entry is correct outside a transition, since this then aliases `boxes`
   * exactly. Do NOT use this for hit-testing — see `boxes`'s docblock and
   * `hitTest`, which deliberately never reads this.
   */
  readonly renderBoxes: Float64Array
  /**
   * Interpolated boxes for exactly the SOURCE indices in the `Uint32Array`
   * `render()` most recently returned, in the SAME order (each entry is 4
   * `Float64`s: x, y, w, h) — `null` whenever no transition is running (a
   * caller should fall back to `boxes`/`visibleToSource` then, rather than
   * pay to duplicate them). Exists for a host that cannot reach this engine
   * directly — one driving it across a Web Worker boundary — to mirror
   * exactly the geometry the overlay/camera-anchor need without transferring
   * the full `renderBoxes` array (which can be O(total pruned count)) every
   * frame. Cost is O(the count `render()` just returned), i.e. bounded by
   * the visible/drawn set, never by total node count.
   */
  readonly lastDrawnBoxes: Float64Array | null
  /**
   * The per-node REVEAL ALPHA for exactly the SOURCE indices in the
   * `Uint32Array` `render()` most recently returned, in the SAME order (one
   * `Float32` each) — `null` whenever nothing on screen is fading, which
   * covers the whole steady state and every collapse (a collapse fades
   * GHOSTS, which have no entry in the drawn set at all).
   *
   * This is the same number `render()` just painted each node's fill and
   * label with, and it exists for the same reason `lastDrawnBoxes` does: a
   * host drawing its own DOM layer over the canvas — the vanilla layer's
   * pooled overlay — has to match what the canvas did, or the two disagree.
   * They did: an expand's phase 1 deliberately holds newly revealed children
   * at alpha 0 while their room is being made (see the staged-choreography
   * docblock below), and a host that ignored this painted those children's
   * CARDS at full opacity for that whole phase, at a box that is still a
   * zero-size point on the parent's exit edge.
   *
   * Cost is O(the count `render()` just returned) — bounded by the drawn
   * set, never by total node count — and only paid on the frames where
   * something is actually fading.
   */
  readonly lastDrawnAlpha: Float32Array | null
  readonly bounds: Bounds
  /** Pruned index -> source index. */
  readonly visibleToSource: Int32Array
  /** World-space hit test; returns a SOURCE index or -1. Always resolves
   * against the final layout, even mid-transition. */
  hitTest(worldX: number, worldY: number): number
  /**
   * Snapshot for `render/svg.ts`'s `toSVG`/for a host's `toBlob`/`print`.
   * Deliberately just the FINAL layout (never an in-progress transition's
   * interpolated positions, same discipline as `boxes`/`hitTest` above) over
   * the whole PRUNED tree — i.e. every visible node, not merely whatever the
   * current camera/viewport happens to cull in, since export's whole point
   * is to cover the visible tree regardless of viewport (see the design doc,
   * section 11.3). Forces a relayout first if one is pending, exactly like
   * `hitTest` does, so a caller who exports immediately after `setData`/
   * `setOpen` without an intervening `render()` still gets current geometry.
   */
  getExportData(): ExportData
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
 * Builds a spatial index over CONNECTORS, not nodes.
 *
 * The old approach inferred "which connectors might be on screen" from a
 * margin-widened NODE query: widen the viewport rect by `cullMargin` along
 * the tree's growth axis, then treat every node the widened query returns as
 * "draw its connector too". That margin is provably sufficient on the growth
 * axis — a direct parent/child pair's near edges are exactly one level (node
 * extent + spacing) apart, by construction of `tidy.ts`'s `y[i]` formula.
 *
 * It is NOT sufficient on the CROSS axis, and no constant margin ever could
 * be: siblings can be separated by an entire subtree's width, so a
 * connector's cross-axis run is unbounded. A parent centred far to one side
 * of a wide subtree and a lone narrow child on the other can have their
 * elbow's crossbar sweep clear across the screen while neither node's own
 * box comes anywhere near the viewport — see engine.test.ts's "defect 2".
 *
 * The fix: index the connectors' own bounding boxes directly, and query that
 * index with the exact (unwidened) viewport rect. A connector's box is the
 * rectangle spanned by its parent's exit point and its child's entry point —
 * exactly the elbow's extent, since the elbow's horizontal and vertical legs
 * never travel outside that rectangle (the mid-line the elbow bends at is
 * always between the two anchor points). Querying this index therefore gives
 * the exactly-correct set of on-screen connectors, at the same asymptotic
 * cost as the node query — bounded by what's near the viewport, never by
 * total node count.
 *
 * Anchor points here MUST mirror canvas2d.ts's elbow-drawing formulas
 * exactly: this index has to describe the same rectangle the renderer
 * actually paints, or it either misses connectors that are drawn or invents
 * ones that aren't.
 *
 * One box per non-root pruned node (its edge to its own parent); roots
 * contribute nothing; `child[k]` maps a result from `quad.query` (which
 * returns positions in the compacted `edgeBoxes` array, not pruned indices)
 * back to the pruned CHILD index that edge belongs to.
 *
 * Cost is O(pruned count), folded into the same relayout pass that already
 * builds the node quadtree — never touched by `render()`'s per-frame,
 * camera-only path.
 */
/**
 * The point where a connector LEAVES a box shaped `(x, y, w, h)` — the
 * PARENT side of the elbow drawn between a parent and child, in the growth
 * direction `horizontal` implies. MUST mirror canvas2d.ts's elbow-drawing
 * formula exactly (`draw`'s `frame.horizontal` branch: `(px, py)`) — every
 * caller of this function ends up describing where a connector visually
 * attaches, whether for culling (`buildEdgeIndex`, below) or for the reveal/
 * ghost "emerge from the parent" point (`render()`'s `applyTween`, over in
 * `createChartEngine`) — a formula drifting out of step with the renderer's
 * own elbow math would misplace either one. Takes raw `(x, y, w, h)` rather
 * than a `Box` — `Box` isn't declared until further down this file, and
 * `buildEdgeIndex` (the other caller) already works in raw `Float64Array`
 * offsets to avoid an allocation per edge in its O(pruned count) build; see
 * `exitPoint` below for the `Box`-typed convenience wrapper `render()` uses.
 */
function exitPointXY(x: number, y: number, w: number, h: number, horizontal: boolean): { x: number; y: number } {
  return horizontal
    ? { x: x + w, y: y + h / 2 } // right edge, vertical centre
    : { x: x + w / 2, y: y + h } // bottom edge, horizontal centre
}

function buildEdgeIndex(
  boxes: Float64Array,
  parent: Int32Array,
  bounds: Bounds,
  horizontal: boolean,
): { quad: QuadTree | null; child: Int32Array } {
  const n = parent.length
  let count = 0
  for (let i = 0; i < n; i++) if (parent[i]! !== -1) count++
  if (count === 0) return { quad: null, child: new Int32Array(0) }

  const edgeBoxes = new Float64Array(count * 4)
  const child = new Int32Array(count)
  let e = 0
  for (let i = 0; i < n; i++) {
    const p = parent[i]!
    if (p === -1) continue
    const io = i * 4
    const po = p * 4
    let cx: number
    let cy: number
    const exit = exitPointXY(boxes[po]!, boxes[po + 1]!, boxes[po + 2]!, boxes[po + 3]!, horizontal)
    const px = exit.x
    const py = exit.y
    if (horizontal) {
      // Growth axis is x: leave the parent's right edge, enter the child's
      // left edge. Matches canvas2d.ts's `horizontal` branch exactly.
      cx = boxes[io]!
      cy = boxes[io + 1]! + boxes[io + 3]! / 2
    } else {
      // Matches canvas2d.ts's non-`horizontal` branch exactly.
      cx = boxes[io]! + boxes[io + 2]! / 2
      cy = boxes[io + 1]!
    }
    const x0 = px < cx ? px : cx
    const x1 = px > cx ? px : cx
    const y0 = py < cy ? py : cy
    const y1 = py > cy ? py : cy
    const o = e * 4
    edgeBoxes[o] = x0
    edgeBoxes[o + 1] = y0
    edgeBoxes[o + 2] = x1 - x0
    edgeBoxes[o + 3] = y1 - y0
    child[e] = i
    e++
  }
  return { quad: buildQuadTree(edgeBoxes, bounds), child }
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

/** `Box`-typed convenience wrapper over `exitPointXY` (see its docblock) —
 * as a zero-size `Box` (`w`/`h` both 0), ready to hand straight to `lerpBox`
 * as a reveal's growth-start point or a ghost's shrink-target point: a
 * revealed child then visibly emerges from a single POINT at its parent's
 * exit edge and grows to its own size while moving to its final box, rather
 * than starting already sized like the whole parent box — see `render()`'s
 * `applyTween` and the ghost-drawing loop, both in `createChartEngine`. */
function exitBox(box: Box, horizontal: boolean): Box {
  const p = exitPointXY(box.x, box.y, box.w, box.h, horizontal)
  return { x: p.x, y: p.y, w: 0, h: 0 }
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

/**
 * The smallest axis-aligned box containing both `a` and `b`. Used to build a
 * conservative cull bound for a node/edge that MOVES during a transition: a
 * linear interpolation between two boxes (`lerpBox`, above) never leaves the
 * union of its two endpoints — each of x, y, x+w, y+h is a monotonic linear
 * function of `t`, so it stays within the range its own endpoints span — so
 * this box safely bounds every position the tween could occupy for the whole
 * transition, without needing to know `t` at cull time. See `Transition.nodeQuad`'s
 * docblock for why that safety matters.
 */
function unionBox(a: Box, b: Box): Box {
  const x0 = a.x < b.x ? a.x : b.x
  const y0 = a.y < b.y ? a.y : b.y
  const ax1 = a.x + a.w
  const bx1 = b.x + b.w
  const ay1 = a.y + a.h
  const by1 = b.y + b.h
  const x1 = ax1 > bx1 ? ax1 : bx1
  const y1 = ay1 > by1 ? ay1 : by1
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * The expand/collapse transition is a STAGED choreography, not one
 * simultaneous tween, per the owner's brief:
 *
 *  - Expand: phase 1 makes room — the toggled node's siblings (and their
 *    subtrees) reflow into their new positions while the children stay
 *    hidden — then phase 2 reveals the children (grow-from-parent + fade)
 *    into the space phase 1 just opened.
 *  - Collapse is the exact reverse: phase 1 shrinks/fades the children away
 *    toward the parent, then phase 2 closes the gap by reflowing the
 *    siblings back together.
 *
 * So "phase 1" and "phase 2" are just time windows; which VISUAL job each
 * one does (reposition vs. reveal/shrink) flips with the toggle's direction
 * — see `Transition.opening` and `repositionRaw`/`emphasisRaw` below.
 *
 * `PHASE_OVERLAP_MS` lets phase 2 start a little before phase 1 fully
 * finishes, so the hand-off between them reads as one continuous motion
 * rather than two animations with a dead beat in between — small relative to
 * either phase, tuned by eye alongside the phase lengths themselves.
 *
 * Total duration (`TRANSITION_DURATION_MS`, derived below) intentionally
 * stays quick: the owner was explicit that the whole thing must not feel
 * slow, even now that it is two stages rather than one. The former
 * single-phase duration was 420ms; splitting it in two without shortening
 * anything would have doubled the perceived length, so each phase is
 * shorter than that on its own — the two phases together, minus the
 * overlap, land at roughly the same ballpark as before.
 */
const PHASE_ONE_MS = 260
const PHASE_TWO_MS = 260
const PHASE_OVERLAP_MS = 70
const TRANSITION_DURATION_MS = PHASE_ONE_MS + PHASE_TWO_MS - PHASE_OVERLAP_MS

/** Fraction of the total duration phase 1 alone occupies. */
const PHASE_ONE_FRACTION = PHASE_ONE_MS / TRANSITION_DURATION_MS
/** Fraction of the total duration at which phase 2 begins — before phase 1's
 * own fraction ends, by `PHASE_OVERLAP_MS`, for the overlap described above. */
const PHASE_TWO_START_FRACTION = (PHASE_ONE_MS - PHASE_OVERLAP_MS) / TRANSITION_DURATION_MS

function clamp01(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t
}

/** Raw (un-eased) progress through phase 1 alone, given the OVERALL raw
 * transition progress (0..1). Clamped: stays at 1 for the remainder of the
 * transition once phase 1 itself is done. */
function phaseOneProgress(overall: number): number {
  return clamp01(overall / PHASE_ONE_FRACTION)
}

/** Raw (un-eased) progress through phase 2 alone. Clamped: stays at 0 until
 * phase 2 actually starts. */
function phaseTwoProgress(overall: number): number {
  return clamp01((overall - PHASE_TWO_START_FRACTION) / (1 - PHASE_TWO_START_FRACTION))
}

/**
 * Raw progress for the REPOSITION job — siblings sliding apart to make room
 * (expand) or sliding back together to close the gap (collapse) — as a
 * function of the toggle's direction. This is phase 1 on an expand (make
 * room FIRST) and phase 2 on a collapse (close the gap LAST, after the
 * children have already left).
 */
function repositionRaw(overall: number, opening: boolean): number {
  return opening ? phaseOneProgress(overall) : phaseTwoProgress(overall)
}

/**
 * Raw progress for the EMPHASIS job — the children's grow+fade reveal
 * (expand) or shrink+fade removal (collapse). Always the mirror of
 * `repositionRaw`: phase 2 on an expand (reveal AFTER room is made), phase 1
 * on a collapse (children leave FIRST, before the gap closes).
 */
function emphasisRaw(overall: number, opening: boolean): number {
  return opening ? phaseTwoProgress(overall) : phaseOneProgress(overall)
}

/**
 * Fraction of the OVERALL transition duration by which a collapsed ghost
 * must be fully transparent — deliberately its OWN, shorter window,
 * independent of `PHASE_ONE_FRACTION` (the ~58% of the transition phase 1
 * itself occupies). A ghost whose alpha merely rides `emphasisRaw` stays
 * part-visible for that entire first phase (up to ~260ms here), which reads
 * as a lingering blank `nodeFill` box trailing the collapse rather than a
 * card dissolving away — the owner's exact complaint (worse the more the
 * canvas background contrasts with `nodeFill`, e.g. a dark background
 * behind a white default fill). Front-loading the fade into roughly the
 * first third of the transition's total life still shows a brief hint of
 * the card shrinking, then lets it vanish well before phase 2 (gap-closing)
 * even starts at `PHASE_TWO_START_FRACTION` (~42%) — "gone", not "trailing".
 */
const GHOST_FADE_FRACTION = 0.35

/** Raw (un-eased) progress through the ghost's own fade window. Clamped:
 * stays at 1 for the remainder of the transition once the window closes. */
function ghostFadeRaw(overall: number): number {
  return clamp01(overall / GHOST_FADE_FRACTION)
}

interface TweenEntry {
  /** For a surviving (`revealed: false`) entry: its own OLD box, the start
   * point of its old->new reposition tween (unchanged meaning). For a
   * REVEALED entry: its own NEW (final) box, used ONLY as the fallback
   * growth-start point when `anchor` is `-1` — i.e. "no ancestor to grow
   * from" reduces to "start already at the final box", a fade-in with no
   * visible motion. Whenever `anchor` is NOT `-1`, this field is unused: the
   * real growth-start point is read live from the anchor instead (see
   * `anchor`'s docblock) and the growth END point is always `boxAt(boxes,
   * idx)`, computed fresh in `render()`, not stored here. */
  box: Box
  /** True for a node newly revealed by this transition (no prior position of
   * its own) — drives the fade-in; false for a node that already existed and
   * is merely moving. */
  revealed: boolean
  /**
   * REVEALED entries only (meaningless, always `-1`, on a `revealed: false`
   * entry): pruned index, in the tree this `Transition` was built against, of
   * the nearest surviving ancestor to grow from — or `-1` if the whole
   * ancestor chain up to a root is ALSO newly revealed by this same
   * transition (rare; falls back to the entry's own `box`, i.e. no visible
   * growth, just a fade-in in place).
   *
   * Deliberately an INDEX, not a `Box` baked in once here: the anchor is
   * itself a surviving node, which can be mid-reposition (sliding to make
   * room, or recentring over a changed child set) for the very same
   * transition — see the module docblock's "STAGED choreography" and the
   * owner's report that reveals/ghosts were growing from / shrinking to the
   * anchor's STALE pre-toggle position while the anchor itself visibly slid
   * somewhere else. Reading `renderBoxes[anchor]` fresh every frame in
   * `render()` (via `applyTween`, which is idempotent so calling it again for
   * an index already handled this frame is harmless) instead gets the
   * anchor's own live reposition tween, so a reveal grows from — and a ghost
   * shrinks into — wherever the anchor actually is at that instant.
   */
  anchor: number
}

interface Ghost {
  /** SOURCE index — ghosts have no pruned index in the new tree. */
  source: number
  from: Box
  /**
   * Pruned index, in the tree this `Ghost` was minted against, of the
   * nearest surviving ancestor to shrink/fade toward, or `-1` if none was
   * found (falls back to `from`, i.e. the ghost fades in place without
   * shrinking). Read live via `renderBoxes` every frame in `render()` — see
   * `TweenEntry.anchor`'s docblock for why this is an index, not a `Box`
   * snapshot.
   */
  anchor: number
  /**
   * SOURCE index of that same ancestor, or `-1` — stable across relayouts,
   * unlike `anchor` itself (a pruned index is only valid within the
   * relayout that produced it). What lets a ghost that survives into a
   * SECOND transition (still fading when another toggle lands before this
   * one finishes — see `buildTransition`'s carry-over loop) re-resolve
   * `anchor` as a valid pruned index in the tree that new transition was
   * built against, rather than reusing a pruned index that may now point at
   * an unrelated node or nothing at all.
   */
  anchorSource: number
}

/** Common shape of anything `progressOf` can time: a start timestamp and a
 * duration, both in the caller's clock units. `Transition` and `RingFlash`
 * both satisfy this structurally — one function, no duplicated math. */
interface TimedAnimation {
  startedAt: number
  duration: number
}

interface Transition extends TimedAnimation {
  /** Keyed by SOURCE index (stable across a toggle, unlike a pruned index). */
  fromBySource: Map<number, TweenEntry>
  ghosts: Ghost[]
  /** Built once over each ghost's from/to union box; queried every frame like
   * the main quadtree, so a huge collapsed subtree only costs at cull time
   * for the ghosts actually near the viewport. */
  ghostQuad: QuadTree | null
  /**
   * Built once over every pruned node's own from/to union box (`unionBox`,
   * `Ghost.anchor`-style anchor ranges for revealed entries) — queried
   * INSTEAD OF the plain final-layout `quad` for as long as this transition
   * is running, to fix a real bug: `render()`'s node cull used to query the
   * FINAL layout directly, but a node's DRAWN (interpolated) position can be
   * arbitrarily far from where it settles, especially the toggled node
   * itself under a host's camera anchor (see `packages/vanilla`'s
   * `applyCameraAnchor`) — the anchor holds that node's OWN on-screen spot
   * fixed by solving the camera around wherever it currently interpolates
   * TO, which means its FINAL box, read through that same live camera, sits
   * exactly as far from centre-screen as it still has left to travel. Early
   * in a transition that offset can push the final box fully outside the
   * viewport, so a cull keyed to the final box would silently drop the node
   * from `cullBuffer` for a frame or two — even though it's sitting in plain
   * sight at its interpolated position — which reads as a flash: the
   * survivor disappears, then reappears once the offset shrinks back to
   * zero near the end. Querying the union-box quad instead means "is this
   * node's box ANYWHERE it could be for the rest of this transition inside
   * the viewport" rather than "is it there at the very end", so a node that
   * is genuinely on screen right now is never excluded. Bounded the same way
   * `ghostQuad` is: built once per relayout (O(pruned count), the same class
   * of one-time cost `relayout()` already pays), queried every frame at
   * near-viewport cost only.
   */
  nodeQuad: QuadTree | null
  /**
   * The connector analogue of `nodeQuad` — built over the union, per edge, of
   * its parent's and child's `nodeQuad` boxes (a safe superset: both
   * endpoints individually stay inside their own union box for the whole
   * transition, so the elbow between them never leaves the union of the
   * two). Indexed identically to the engine's own (module-scope) `edgeQuad`
   * — same iteration order over `edgeChild` — so a query result translates
   * through that SAME `edgeChild` array regardless of which of the two edge
   * quads produced it.
   */
  edgeQuad: QuadTree | null
  /** True for an expand (the toggle that started this transition set a node
   * OPEN, revealing descendants), false for a collapse (it set one CLOSED,
   * removing them). Decides which physical phase — 1 or 2 — the reposition
   * job and the emphasis job each land in; see `repositionRaw`/`emphasisRaw`.
   * Captured once from the `setOpen` call that armed this transition (see
   * `pendingTransitionOpening`), not re-derived from the transition's
   * contents, because a mixed transition (rare: several distinct toggles
   * landing before one relayout) can carry both reveals and ghosts at once,
   * and there is no way to recover "which direction" from that mix after the
   * fact — the direction of the LAST toggle that triggered this relayout is
   * the only sensible single answer. */
  opening: boolean
}

function progressOf(t: TimedAnimation, now: number): number {
  if (t.duration <= 0) return 1
  const raw = (now - t.startedAt) / t.duration
  return raw <= 0 ? 0 : raw >= 1 ? 1 : raw
}

/** The three eased values `render()` and `buildTransition()` both need for a
 * given transition at a given instant — computed once per use so the two
 * call sites can never drift apart on which curve goes with which job. */
interface TransitionEasing {
  /** Drives the position tween of ordinary surviving nodes (`revealed:
   * false` entries) — the "make room" / "close the gap" reflow. */
  repositionPos: number
  /** Drives the position (grow-from-parent / shrink-to-parent) tween of
   * revealed entries and ghosts — the "reveal" / "shrink away" job. */
  emphasisPos: number
  /** Drives the alpha fade-IN of revealed entries (an expand). A separate
   * curve from `emphasisPos` for the same reason the old single-phase code
   * kept position and alpha separate: `easeOutCubic`'s fast-start fade still
   * reads right for a fade, but a symmetric ease-in-out is still right for
   * the accompanying move — see the module docblock above. NOT used for
   * ghosts — see `ghostAlpha` below. */
  emphasisAlpha: number
  /** Drives the alpha fade-OUT of ghosts (a collapse's removed nodes). Its
   * own curve, on its own (shorter) window — see `ghostFadeRaw` — rather
   * than reusing `emphasisAlpha`/`emp`, so a ghost reads as dissolving away
   * quickly rather than lingering as a blank box through all of phase 1. */
  ghostAlpha: number
}

function easingFor(transition: Transition, now: number): TransitionEasing {
  const overall = progressOf(transition, now)
  const rep = repositionRaw(overall, transition.opening)
  const emp = emphasisRaw(overall, transition.opening)
  return {
    repositionPos: easeInOutCubic(rep),
    emphasisPos: easeInOutCubic(emp),
    emphasisAlpha: easeOutCubic(emp),
    ghostAlpha: 1 - easeOutCubic(ghostFadeRaw(overall)),
  }
}

/**
 * Public, side-effect-free escape hatch for a DOM-aware host's camera math —
 * NOT used by `render()` itself (which goes through `easingFor` above against
 * its own live `Transition` object).
 *
 * The toggled node always survives its own toggle (a `setOpen` call only
 * ever affects its DESCENDANTS' visibility), so it is always a "reposition"
 * entry, never a "reveal"/"ghost" one. A host that wants to hold that node's
 * SCREEN position fixed while the layout moves around it (see
 * packages/vanilla's camera anchor) needs to know exactly how far that one
 * node has travelled between its pre-toggle and post-toggle box at any
 * instant — which is exactly this curve, the same one `easingFor` computes
 * internally for `repositionPos`. Exposing the curve itself (pure function of
 * `startedAt`/`now`/`opening`) rather than a per-node accessor on
 * `ChartEngine` keeps this usable from a host that may be rendering through a
 * Web Worker, where no engine instance is reachable at all: the host already
 * knows the node's pre- and post-toggle world box on the main thread (it
 * asked for both, once each), and only needs this one number per frame to
 * interpolate between them itself.
 */
export function transitionAnchorProgress(startedAt: number, now: number, opening: boolean): number {
  const overall = progressOf({ startedAt, duration: TRANSITION_DURATION_MS }, now)
  return easeInOutCubic(repositionRaw(overall, opening))
}

/**
 * Deliberately much longer than `TRANSITION_DURATION_MS`. The first attempt
 * matched the layout transition at 350ms and was reported as imperceptible —
 * the ring is a thin, low-contrast outline, and a thin line needs noticeably
 * longer on screen than a moving block does to register at all. The layout
 * settles first and the ring resolves after it, which is the intended reading
 * order anyway: the chart rearranges, then the confirmation fades.
 *
 * Not exposed as a knob yet, same reasoning as `TRANSITION_DURATION_MS`.
 */
const RING_DURATION_MS = 900

/**
 * A one-shot flash ring drawn around the node a `setOpen` toggle just acted
 * on — a confirmation, not a celebration: it fires once, expands slightly,
 * and fades out, never repeating. Keyed by SOURCE index (like `Ghost`, and
 * for the same reason: a toggle can remove the node's OWN pruned index only
 * if the node itself were pruned, which never happens for the node someone
 * just toggled — but resolving via source keeps this consistent with every
 * other piece of toggle-driven state here).
 */
interface RingFlash extends TimedAnimation {
  source: number
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
  opening: boolean,
  /** This relayout's own `edgeChild` (edge-array position -> pruned CHILD
   * index) — needed to build `Transition.edgeQuad` in the SAME iteration
   * order as the engine's own (module-scope) `edgeQuad`, so a query result
   * from either one translates through this same array. See
   * `Transition.edgeQuad`'s docblock. */
  edgeChild: Int32Array,
): Transition {
  // 1. Wherever every old-layout node (and any still-fading ghost) visually
  // is RIGHT NOW, not where it started or where it will settle — this is
  // what makes a second toggle mid-flight retarget instead of snapping.
  // Each entry/ghost is repositioned using the SAME curve `render()` was
  // actually drawing it with a moment ago (`easingFor`, keyed by whether it
  // was a reposition or an emphasis entry, and by the OLD transition's own
  // `opening`) — otherwise a toggle that lands mid-transition would retarget
  // FROM a point computed on one curve while animating TO it on another,
  // which is exactly the kind of seam that reads as a stutter.
  const prevPositionBySource = new Map<number, Box>()
  const prevEasing = prevTransition === null ? null : easingFor(prevTransition, now)
  for (let i = 0; i < prevVisibleToSource.length; i++) {
    const src = prevVisibleToSource[i]!
    let box = boxAt(prevBoxes, i)
    if (prevTransition !== null) {
      const entry = prevTransition.fromBySource.get(src)
      if (entry !== undefined) {
        const t = entry.revealed ? prevEasing!.emphasisPos : prevEasing!.repositionPos
        box = lerpBox(entry.box, box, t)
      }
    }
    prevPositionBySource.set(src, box)
  }
  if (prevTransition !== null) {
    for (const ghost of prevTransition.ghosts) {
      if (!prevPositionBySource.has(ghost.source)) {
        // `ghost.anchor` was a pruned index in THAT transition's tree — which
        // is exactly this function's "old"/prev tree, i.e. `prevVisibleToSource`
        // — so the anchor's SOURCE (`ghost.anchorSource`) already has a live,
        // as-of-`now` position in `prevPositionBySource` from the per-source
        // loop just above (every source in `prevVisibleToSource` is set
        // there before this ghost pass runs). Reading it by source, not by
        // re-deriving `ghost.anchor`'s box some other way, is what keeps this
        // a still-fading ghost tracking its anchor's OWN live reposition
        // tween — same "live anchor, not a stale snapshot" fix as
        // `render()`'s ghost-drawing loop.
        const to =
          ghost.anchor === -1 ? ghost.from : (prevPositionBySource.get(ghost.anchorSource) ?? ghost.from)
        prevPositionBySource.set(ghost.source, lerpBox(ghost.from, to, prevEasing!.emphasisPos))
      }
    }
  }

  // 2. Surviving (tweened) and newly-revealed nodes. `resolveRevealAnchor`
  // walks the NEW tree's parent chain looking for the nearest ancestor with a
  // prior position, memoizing every pruned index it passes through so a
  // multi-level reveal (expanding a grandparent) costs O(1) amortized per
  // node instead of O(depth) per node. It returns that ancestor's PRUNED
  // INDEX, not a baked box — see `TweenEntry.anchor`'s docblock for why.
  const fromBySource = new Map<number, TweenEntry>()
  const revealCache = new Map<number, number>()
  const resolveRevealAnchor = (i: number): number => {
    const cached = revealCache.get(i)
    if (cached !== undefined) return cached
    const path: number[] = []
    let p = prunedParent[i]!
    let result = -1
    while (p !== -1) {
      const viaCache = revealCache.get(p)
      if (viaCache !== undefined) {
        result = viaCache
        break
      }
      const psrc = visibleToSource[p]!
      if (prevPositionBySource.has(psrc)) {
        result = p
        break
      }
      path.push(p)
      p = prunedParent[p]!
    }
    for (const idx of path) revealCache.set(idx, result)
    revealCache.set(i, result)
    return result
  }

  for (let i = 0; i < visibleToSource.length; i++) {
    const src = visibleToSource[i]!
    const prev = prevPositionBySource.get(src)
    if (prev !== undefined) fromBySource.set(src, { box: prev, revealed: false, anchor: -1 })
    else fromBySource.set(src, { box: boxAt(boxes, i), revealed: true, anchor: resolveRevealAnchor(i) })
  }

  // 3. Removed nodes become ghosts, collapsing toward the nearest ancestor
  // that survived into the new tree. `resolveGhostAnchor` walks the OLD
  // tree's parent chain (the new tree has no entry for a removed node to
  // walk from) with the same memoization trick as `resolveRevealAnchor`, and
  // likewise returns a PRUNED INDEX rather than a baked box.
  const ghosts: Ghost[] = []
  const ancestorCache = new Map<number, number>()
  const resolveGhostAnchor = (oldIdx: number): number => {
    const path: number[] = []
    let idx = prevParent[oldIdx]!
    let result = -1
    while (idx !== -1) {
      const src = prevVisibleToSource[idx]!
      const cached = ancestorCache.get(src)
      if (cached !== undefined) {
        result = cached
        break
      }
      const newIdx = prunedFromSource[src]!
      if (newIdx !== -1) {
        result = newIdx
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
    const anchor = resolveGhostAnchor(i)
    ghosts.push({ source: src, from, anchor, anchorSource: anchor === -1 ? -1 : visibleToSource[anchor]! })
  }
  // Ghosts already mid-fade from a PRIOR transition, still absent from the
  // new tree, keep fading from wherever they currently are — their source is
  // never also in `prevVisibleToSource` (a node is either still pruned-tree
  // or already a ghost, never both), so this cannot double-add one.
  //
  // `anchor` cannot simply be carried over: a pruned index is only valid in
  // the tree it was resolved against, and this is a NEW relayout with its own
  // pruned index space — last transition's `anchor` may now name an unrelated
  // node, or nothing. `anchorSource` (a SOURCE index, stable across relayouts)
  // is what survives the trip: re-resolving it against `prunedFromSource`
  // (this relayout's source -> new-pruned-index map) gives a valid anchor in
  // THIS tree, or `-1` if that ancestor has itself since been pruned out (the
  // ghost then just fades in place, same degrade-gracefully fallback as
  // "no ancestor found" elsewhere in this function).
  if (prevTransition !== null) {
    for (const ghost of prevTransition.ghosts) {
      if (prunedFromSource[ghost.source] !== -1) continue // reappeared; handled as a reveal above
      const from = prevPositionBySource.get(ghost.source)!
      const anchor = ghost.anchorSource === -1 ? -1 : prunedFromSource[ghost.anchorSource]!
      ghosts.push({
        source: ghost.source,
        from,
        anchor,
        anchorSource: anchor === -1 ? -1 : ghost.anchorSource,
      })
    }
  }

  // The ghost-quadtree query box has to bound every position a ghost could
  // occupy for the rest of the transition — `from` (fixed) union the
  // ANCHOR's own full old->new range (since the anchor, a surviving node,
  // can itself be mid-reposition for the same transition; the ghost tracks
  // wherever the anchor currently is, live — see `Ghost.anchor`'s
  // docblock), not just a single static "to" point the way a baked anchor
  // box used to make this simple. `anchorRange` reads the anchor's OLD box
  // from `fromBySource` (already populated by step 2, above) and its NEW box
  // straight from `boxes` — both O(1), no tree walk.
  const anchorRange = (anchor: number): [Box, Box] | null => {
    if (anchor === -1) return null
    const entry = fromBySource.get(visibleToSource[anchor]!)!
    return [entry.box, boxAt(boxes, anchor)]
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
      const range = anchorRange(ghost.anchor)
      const toA = range === null ? ghost.from : range[0]
      const toB = range === null ? ghost.from : range[1]
      const x0 = Math.min(ghost.from.x, toA.x, toB.x)
      const y0 = Math.min(ghost.from.y, toA.y, toB.y)
      const x1 = Math.max(ghost.from.x + ghost.from.w, toA.x + toA.w, toB.x + toB.w)
      const y1 = Math.max(ghost.from.y + ghost.from.h, toA.y + toA.h, toB.y + toB.h)
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

  // `nodeQuad`/`edgeQuad`: see `Transition.nodeQuad`'s docblock for why
  // `render()` needs these instead of the plain final-layout quads while
  // this transition is running. Two passes over the new pruned tree:
  // survivors (`revealed: false`) first, since a revealed entry's anchor is
  // ALWAYS a survivor (`TweenEntry.anchor`'s docblock) — the second pass
  // reads the anchor's already-written union box directly, by pruned index,
  // in O(1), no tree walk needed here (the walk already happened once, in
  // `resolveRevealAnchor` above).
  const prunedCount = visibleToSource.length
  const nodeUnionBoxes = new Float64Array(prunedCount * 4)
  for (let i = 0; i < prunedCount; i++) {
    const entry = fromBySource.get(visibleToSource[i]!)!
    if (entry.revealed) continue
    writeBox(nodeUnionBoxes, i, unionBox(entry.box, boxAt(boxes, i)))
  }
  for (let i = 0; i < prunedCount; i++) {
    const entry = fromBySource.get(visibleToSource[i]!)!
    if (!entry.revealed) continue
    const growthRange = entry.anchor === -1 ? entry.box : boxAt(nodeUnionBoxes, entry.anchor)
    writeBox(nodeUnionBoxes, i, unionBox(entry.box, growthRange))
  }

  let nodeQuad: QuadTree | null = null
  if (prunedCount > 0) {
    let nMinX = Infinity
    let nMinY = Infinity
    let nMaxX = -Infinity
    let nMaxY = -Infinity
    for (let i = 0; i < prunedCount; i++) {
      const o = i * 4
      const x0 = nodeUnionBoxes[o]!
      const y0 = nodeUnionBoxes[o + 1]!
      const x1 = x0 + nodeUnionBoxes[o + 2]!
      const y1 = y0 + nodeUnionBoxes[o + 3]!
      if (x0 < nMinX) nMinX = x0
      if (y0 < nMinY) nMinY = y0
      if (x1 > nMaxX) nMaxX = x1
      if (y1 > nMaxY) nMaxY = y1
    }
    nodeQuad = buildQuadTree(nodeUnionBoxes, { minX: nMinX, minY: nMinY, maxX: nMaxX, maxY: nMaxY })
  }

  // Edge analogue: each edge's cull box is the union of its parent's and
  // child's OWN union box — a safe superset, since both endpoints
  // individually stay inside their own union box for the whole transition
  // (`unionBox`'s docblock), so the elbow between them never leaves the
  // union of the two. Same `edgeChild` iteration order as the engine's own
  // (module-scope) `edgeQuad`, so a query result from either quad translates
  // through that same array.
  let edgeQuad: QuadTree | null = null
  const edgeCount = edgeChild.length
  if (edgeCount > 0) {
    const edgeUnionBoxes = new Float64Array(edgeCount * 4)
    let eMinX = Infinity
    let eMinY = Infinity
    let eMaxX = -Infinity
    let eMaxY = -Infinity
    for (let e = 0; e < edgeCount; e++) {
      const child = edgeChild[e]!
      const parentIdx = prunedParent[child]!
      const childBox = boxAt(nodeUnionBoxes, child)
      const box = parentIdx === -1 ? childBox : unionBox(childBox, boxAt(nodeUnionBoxes, parentIdx))
      writeBox(edgeUnionBoxes, e, box)
      const x1 = box.x + box.w
      const y1 = box.y + box.h
      if (box.x < eMinX) eMinX = box.x
      if (box.y < eMinY) eMinY = box.y
      if (x1 > eMaxX) eMaxX = x1
      if (y1 > eMaxY) eMaxY = y1
    }
    edgeQuad = buildQuadTree(edgeUnionBoxes, { minX: eMinX, minY: eMinY, maxX: eMaxX, maxY: eMaxY })
  }

  return { startedAt: now, duration: TRANSITION_DURATION_MS, fromBySource, ghosts, ghostQuad, nodeQuad, edgeQuad, opening }
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
  /** Spatial index over connector boxes, keyed to `edgeChild`. See
   * `buildEdgeIndex`'s docblock for why this replaced the old
   * growth-axis-only `cullMargin` widening: this index is exact on BOTH
   * axes, where a constant margin only ever could be on one of them. */
  let edgeQuad: QuadTree | null = null
  /** `edgeQuad` result position -> pruned CHILD index whose connector that
   * box belongs to. `quad.query` returns positions in the compacted edge-box
   * array (one entry per non-root node), not pruned indices directly, so
   * this translates. */
  let edgeChild: Int32Array = new Int32Array(0)

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
  // Same reused-and-grown discipline as `cullBuffer`, for the edge query:
  // `edgeQueryBuffer` holds raw `edgeQuad.query` results (edge-array-space
  // positions); `edgeDrawBuffer` holds those translated through `edgeChild`
  // into pruned CHILD indices, which is what `Frame.edges` hands the
  // renderer. Two arrays, not one translated in place, so a partially
  // translated buffer is never read as if it were edge-array-space or vice
  // versa.
  let edgeQueryBuffer = new Uint32Array(0)
  let edgeDrawBuffer = new Uint32Array(0)
  let highlightBuffer: Uint8Array | null = null

  // --- expand/collapse transition state ---
  let animate = false
  // Set by `setOpen` when it actually flips a flag; consumed (and reset) by
  // the next `relayout()`. `setData`/`setOptions`-triggered relayouts leave
  // this false, so loading a new dataset or changing spacing/orientation
  // still snaps instantly — only a toggle animates.
  let pendingTransition = false
  // The DIRECTION of whichever `setOpen` call most recently set
  // `pendingTransition` true — i.e. whether that call opened or closed its
  // node. Read only when `pendingTransition` is (see `relayout`), so a stale
  // value left over from an earlier toggle is never mistakenly consulted.
  let pendingTransitionOpening = true
  let transition: Transition | null = null
  // The boxes actually handed to the renderer. Aliases `boxes` (zero extra
  // cost) whenever no transition is running; a real mutable copy, selectively
  // overwritten per frame for only the near-viewport entries, while one is.
  let renderBoxes: Float64Array = new Float64Array(0)
  let ghostCullBuffer = new Uint32Array(0)
  let ghostDrawBoxes = new Float64Array(0)
  let ghostDrawAlpha = new Float32Array(0)
  let revealAlphaBuffer = new Float32Array(0)
  // Interpolated boxes for exactly the SOURCE indices `render()` most
  // recently returned, in the same order (4 float64s per entry) — freshly
  // allocated every `render()` call (same discipline as `drawn` itself,
  // which this is built alongside: bounded by `nodeCount`, never total node
  // count), and `null` whenever no transition is running. A host that
  // cannot reach this engine directly — one driving it from across a Web
  // Worker — cannot read `renderBoxes` above (that array lives, and is
  // mutated, only on this side of the boundary), so this is what crosses
  // instead: paired with `render()`'s own return value, it gives exactly
  // the geometry the DOM overlay and the camera anchor need, at a cost
  // proportional to the visible/drawn set. See `worker/protocol.ts`'s
  // `frame` message and `worker/host.ts`'s mirroring of this getter.
  let lastDrawnBoxes: Float64Array | null = null
  // Companion to `lastDrawnBoxes`, same alignment and same per-frame
  // allocation discipline, for the reveal alpha — see
  // `ChartEngine.lastDrawnAlpha`.
  let lastDrawnAlpha: Float32Array | null = null

  // --- one-shot toggle ring state ---
  // `setOpen` arms a CANDIDATE here — but only when its caller-supplied
  // `ring` argument says to — and `relayout()` resolves it into `ring` (or
  // drops it) the next time it runs, exactly like `pendingTransition` above.
  // SOURCE index of the candidate, or -1 when none is armed. There is no
  // bulk-vs-single inference here any more: a `setOpen(i, v, false)` call
  // (a deep toggle's descendant, or any call inside an `expandAll`/
  // `collapseAll` loop) simply never touches this, so a burst of such calls
  // leaves it exactly as it found it — untouched at -1 for a real bulk
  // operation, or already pointing at the one node a deep toggle's FIRST
  // call armed it for.
  let pendingRingSource = -1
  let ring: RingFlash | null = null
  // Reused each frame instead of allocating — at most one ring is ever live.
  let ringBoxBuffer = new Float64Array(4)

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

    for (let i = 0; i < n; i++) {
      const src = visibleToSource[i]!
      const w = sourceSizes[src * 2] ?? 0
      const h = sourceSizes[src * 2 + 1] ?? 0
      sizes[i * 2] = horizontal ? h : w
      sizes[i * 2 + 1] = horizontal ? w : h
      prunedLabels[i] = sourceLabels[src] ?? ''
    }

    const result = layout(pruned.tree, sizes, {
      spacingX: horizontal ? options.spacingY : options.spacingX,
      spacingY: horizontal ? options.spacingX : options.spacingY,
    })
    boxes = result.boxes
    bounds = applyOrientation(boxes, result.bounds, options.orientation, options.rtl)
    quad = buildQuadTree(boxes, bounds)
    const edgeIndex = buildEdgeIndex(boxes, prunedParent, bounds, horizontal)
    edgeQuad = edgeIndex.quad
    edgeChild = edgeIndex.child

    if (cullBuffer.length < n) cullBuffer = new Uint32Array(n)
    if (edgeQueryBuffer.length < edgeChild.length) edgeQueryBuffer = new Uint32Array(edgeChild.length)
    if (edgeDrawBuffer.length < edgeChild.length) edgeDrawBuffer = new Uint32Array(edgeChild.length)

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
        pendingTransitionOpening,
        edgeChild,
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

    // Resolve whatever armed the ring — a `setOpen` that asked for one, or a
    // bare `flashRing`. Deliberately here rather than inside `relayout`,
    // where it used to live: a `flashRing` call changes no layout, so a
    // relayout-only resolution would leave it armed until some unrelated
    // change happened to trigger one, and the flash would then appear
    // attached to that instead. Resolving per frame also means the ring's
    // clock is the frame's `now`, the same one the transition and the host's
    // camera anchor are measured against. Gated on `animate`: a
    // reduced-motion host gets no flash.
    if (pendingRingSource !== -1) {
      ring = animate
        ? { source: pendingRingSource, startedAt: now, duration: RING_DURATION_MS }
        : null
      pendingRingSource = -1
    }

    const n = visibleToSource.length
    // Feeds `exitBox` below (the reveal/ghost "emerge from the parent's exit
    // edge" point) — same orientation test `relayout` uses to pick spacing
    // axes, recomputed here rather than stored, since it's O(1) and `render`
    // has no other reason to keep its own copy in step with `options`.
    const horizontal = options.orientation === 'lr' || options.orientation === 'rl'

    // Resolve whether this transition has actually finished as of `now`
    // BEFORE culling: culling needs to know whether to query the
    // transition-aware quads (built below) or the plain final-layout ones,
    // and a transition that just crossed its finish line must use the
    // latter — not the former, which nothing keeps updated once the
    // transition itself is gone.
    if (transition !== null && progressOf(transition, now) >= 1) {
      // Done: fall back to the zero-overhead steady state.
      transition = null
      renderBoxes = boxes
    }

    // `nodeCount`: the exact-viewport node query, drives fill/stroke/label
    // drawing and is what `render()` reports as "on screen".
    // `edgeDrawCount`: the exact-viewport EDGE query, drives connector
    // drawing. Independent of `nodeCount`: a connector can cross the
    // viewport while neither of its endpoints does, and a node's own box can
    // graze the viewport somewhere its connector never reaches. Neither set
    // is a subset of the other; the renderer is handed both.
    //
    // While a transition is running, this queries `transition.nodeQuad`/
    // `transition.edgeQuad` — built over each node's/edge's own old-box/
    // new-box union, not the plain final layout — because a node's DRAWN
    // (interpolated) position can be arbitrarily far from where it settles,
    // most dramatically for the toggled node itself under a host's camera
    // anchor (see `Transition.nodeQuad`'s docblock). Querying the final
    // layout directly here was exactly the "toggled node flashes" bug: a
    // survivor whose FINAL box had drifted outside the viewport, even though
    // its INTERPOLATED one was sitting in plain sight, used to be silently
    // excluded from `cullBuffer` for a frame or two. Outside a transition
    // this aliases the plain `quad`/`edgeQuad` exactly, so there is no extra
    // cost in the steady state.
    let nodeCount = 0
    let edgeDrawCount = 0
    if (n > 0 && viewport.width > 0 && viewport.height > 0) {
      const rect = visibleRect(camera, { width: viewport.width, height: viewport.height })
      const cullNodeQuad = transition !== null ? transition.nodeQuad : quad
      const cullEdgeQuad = transition !== null ? transition.edgeQuad : edgeQuad
      if (cullNodeQuad !== null) nodeCount = cullNodeQuad.query(rect, cullBuffer)
      if (cullEdgeQuad !== null) {
        const written = cullEdgeQuad.query(rect, edgeQueryBuffer)
        for (let i = 0; i < written; i++) edgeDrawBuffer[i] = edgeChild[edgeQueryBuffer[i]!]!
        edgeDrawCount = written
      }
    }

    // --- expand/collapse transition ---
    // Cost here is bounded by `nodeCount` + `edgeDrawCount` (near-viewport
    // nodes and connectors) and by however many ghosts the ghost-quadtree
    // query returns (near-viewport ghosts) — never by total node count,
    // matching the 50k budget.
    let ghostCount = 0
    let revealAlpha: Float32Array | null = null
    if (transition !== null) {
      // `progress < 1` is guaranteed here — the `>= 1` case was already
      // resolved above, before culling.
      // Staged choreography: `repositionPos` (surviving nodes making room
      // or closing the gap) and `emphasisPos`/`emphasisAlpha` (revealed
      // nodes and ghosts growing/fading in or shrinking/fading out) are
      // now DIFFERENT PHASES of the timeline, not just different curves
      // applied to the same instant — see `easingFor`, `repositionRaw`, and
      // `emphasisRaw` above for how `transition.opening` decides which
      // physical phase (1 or 2) each job lands in.
      const easing = easingFor(transition, now)

      // A revealed entry's growth-start point is read live from its
      // ANCHOR (the nearest surviving ancestor) rather than a box baked in
      // once at `buildTransition` time — the anchor can itself be
      // mid-reposition this same transition (sliding to make room, or
      // recentring over a changed child set), so a static snapshot would
      // grow the reveal from where the anchor WAS at the moment of the
      // toggle, not where it visibly IS this frame. Recursing into
      // `applyTween(entry.anchor)` first brings the anchor's OWN
      // `renderBoxes` entry up to date for this frame before it's read —
      // safe (never unbounded): the anchor is always a `revealed: false`
      // entry (see `resolveRevealAnchor`/`resolveGhostAnchor`), so that
      // recursive call always takes the non-revealed branch below and
      // returns without recursing further, one level deep regardless of
      // how far up the tree the anchor sits.
      const applyTween = (idx: number): void => {
        const entry = transition!.fromBySource.get(visibleToSource[idx]!)
        if (entry === undefined) return
        if (!entry.revealed) {
          writeBox(renderBoxes, idx, lerpBox(entry.box, boxAt(boxes, idx), easing.repositionPos))
          return
        }
        let from = entry.box
        if (entry.anchor !== -1) {
          applyTween(entry.anchor)
          // The anchor's EXIT point (bottom edge for tb/bt, trailing edge for
          // lr/rl — wherever its connector actually leaves it), not its whole
          // box: a revealed child emerges from that single point on its
          // parent and grows to its own size while moving to its final box,
          // rather than starting already sized and positioned like the
          // entire parent — the owner's ask (previously it grew out of the
          // anchor's box origin/centre, which read as ballooning out of the
          // middle rather than dropping out of the bottom).
          from = exitBox(boxAt(renderBoxes, entry.anchor), horizontal)
        }
        writeBox(renderBoxes, idx, lerpBox(from, boxAt(boxes, idx), easing.emphasisPos))
      }
      // Every drawn NODE needs its own box tweened, plus its parent's (so
      // a connector reaching up to that parent, drawn from the same
      // `renderBoxes`, doesn't snap one end to the final layout).
      for (let s = 0; s < nodeCount; s++) {
        const idx = cullBuffer[s]!
        applyTween(idx)
        const par = prunedParent[idx]!
        if (par !== -1) applyTween(par)
      }
      // Every drawn CONNECTOR needs both its endpoints tweened too — this
      // is what makes a connector crossing the viewport (independently of
      // either endpoint's own visibility) follow the interpolated
      // positions during a transition instead of snapping to the final
      // layout while its nodes glide.
      for (let s = 0; s < edgeDrawCount; s++) {
        const idx = edgeDrawBuffer[s]!
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
            revealAlphaBuffer[s] = easing.emphasisAlpha
            anyRevealed = true
          } else {
            revealAlphaBuffer[s] = 1
          }
        }
        if (anyRevealed) revealAlpha = revealAlphaBuffer
      }

      if (transition.ghostQuad !== null && viewport.width > 0 && viewport.height > 0) {
        // Unwidened, same as the node/edge queries above: a ghost's own
        // query box (built once in `buildTransition`) is already the union
        // of its `from` and its ANCHOR's full old->new range, so it fully
        // bounds every position the ghost could occupy for the rest of
        // the transition — no additional margin is needed to catch it
        // here (see `buildTransition`'s `anchorRange`).
        const rect = visibleRect(camera, { width: viewport.width, height: viewport.height })
        const total = transition.ghosts.length
        if (ghostCullBuffer.length < total) ghostCullBuffer = new Uint32Array(total)
        const gcount = transition.ghostQuad.query(rect, ghostCullBuffer)
        if (ghostDrawBoxes.length < gcount * 4) ghostDrawBoxes = new Float64Array(gcount * 4)
        if (ghostDrawAlpha.length < gcount) ghostDrawAlpha = new Float32Array(gcount)
        for (let g = 0; g < gcount; g++) {
          const ghost = transition.ghosts[ghostCullBuffer[g]!]!
          // Shrinks toward the anchor's LIVE (reposition-tweened) box, not
          // a stale snapshot of where it was at the moment of the
          // collapse — same live-anchor reasoning as `applyTween`'s
          // revealed-entry branch above; `applyTween` here just brings
          // the anchor's own `renderBoxes` entry up to date for this frame
          // (idempotent, and the anchor is always `revealed: false`, so
          // this never recurses further).
          let to = ghost.from
          if (ghost.anchor !== -1) {
            applyTween(ghost.anchor)
            // Symmetric with the reveal case above: a collapsing ghost
            // shrinks toward the single EXIT point on its surviving
            // ancestor, not the ancestor's whole box, so it visibly
            // disappears back into the bottom/trailing edge it originally
            // emerged from rather than shrinking into the ancestor's centre.
            to = exitBox(boxAt(renderBoxes, ghost.anchor), horizontal)
          }
          writeBox(ghostDrawBoxes, g, lerpBox(ghost.from, to, easing.emphasisPos))
          ghostDrawAlpha[g] = easing.ghostAlpha
        }
        ghostCount = gcount
      }
    }
    // --- end transition ---

    // --- one-shot toggle ring ---
    // Cost here is O(1) regardless of tree size: at most one ring is ever
    // live, so this is never more than a single bounds check plus a single
    // box read, matching "drawing it is one stroked path".
    let ringActive = false
    let ringProgress = 0
    if (ring !== null) {
      const p = progressOf(ring, now)
      if (p >= 1) {
        // Done: same zero-overhead steady state as a finished transition.
        ring = null
      } else {
        // Resolve via `prunedFromSource`, not a linear scan: the ring's
        // SOURCE index is stable across relayouts, but its PRUNED index
        // shifts every time the tree is pruned differently, exactly like
        // every other piece of source-keyed state here (`Ghost.source`,
        // `TweenEntry`'s map key). Guarded rather than assumed in range —
        // the toggled node itself always survives ITS OWN toggle, but an
        // unrelated LATER collapse of an ancestor could prune it away while
        // the ring is still fading, and this must degrade to "no ring"
        // rather than read a stale or out-of-range box.
        const pruned =
          ring.source >= 0 && ring.source < prunedFromSource.length
            ? prunedFromSource[ring.source]!
            : -1
        if (pruned === -1) {
          ring = null
        } else {
          ringActive = true
          ringProgress = p
          // `renderBoxes`, not `boxes`: the ring must follow the same
          // interpolated position as the node itself during a layout
          // transition, per the brief, rather than snapping to the final
          // layout while the node glides. The toggled node is virtually
          // always a genuinely visible node (the user just clicked it), so
          // the ordinary per-frame node-tween loop above has already
          // brought `renderBoxes` at this index up to date this frame.
          const o = pruned * 4
          ringBoxBuffer[0] = renderBoxes[o]!
          ringBoxBuffer[1] = renderBoxes[o + 1]!
          ringBoxBuffer[2] = renderBoxes[o + 2]!
          ringBoxBuffer[3] = renderBoxes[o + 3]!
        }
      }
    }
    // --- end one-shot toggle ring ---

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
      edges: edgeDrawBuffer,
      edgeCount: edgeDrawCount,
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
      ringActive,
      ringBox: ringBoxBuffer,
      ringProgress,
    })

    // Reports only the genuinely on-screen set (see the `ChartEngine.render`
    // docblock) — the wider edge set is an implementation detail of
    // connector drawing, not something a host should see as "visible".
    //
    // `lastDrawnBoxes` is built in the SAME loop, at no extra asymptotic
    // cost (still O(nodeCount)): `null` while idle — a caller should just
    // use `boxes`/`visibleToSource` then, rather than pay to duplicate
    // them — and, while `transition` is non-null, each node's CURRENT
    // interpolated box (already sitting in `renderBoxes` at this exact
    // pruned index, since the tween loop above ran over this same
    // `cullBuffer` a moment ago).
    const drawn = new Uint32Array(nodeCount)
    const drawnBoxes: Float64Array | null = transition === null ? null : new Float64Array(nodeCount * 4)
    // `revealAlpha` is already aligned 1:1 with `cullBuffer` (the loop that
    // filled it walked this same buffer), i.e. with `drawn` — so this is a
    // straight copy out of a reused, grown-not-shrunk scratch buffer into an
    // exactly-sized one a caller may hold on to, exactly like `drawnBoxes`
    // above. `null` whenever nothing is fading, so the steady state and
    // every collapse allocate nothing here.
    const drawnAlpha: Float32Array | null = revealAlpha === null ? null : new Float32Array(nodeCount)
    for (let i = 0; i < nodeCount; i++) {
      const idx = cullBuffer[i]!
      drawn[i] = visibleToSource[idx]!
      if (drawnBoxes !== null) {
        const src = idx * 4
        const dst = i * 4
        drawnBoxes[dst] = renderBoxes[src]!
        drawnBoxes[dst + 1] = renderBoxes[src + 1]!
        drawnBoxes[dst + 2] = renderBoxes[src + 2]!
        drawnBoxes[dst + 3] = renderBoxes[src + 3]!
      }
      if (drawnAlpha !== null) drawnAlpha[i] = revealAlpha![i]!
    }
    lastDrawnBoxes = drawnBoxes
    lastDrawnAlpha = drawnAlpha
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
      // Same reasoning for the ring: its SOURCE index means nothing against
      // a new dataset, so drop any candidate and any in-flight flash.
      pendingRingSource = -1
      ring = null
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
    // Third parameter named `wantsRing`, not `ring`, purely to avoid shadowing
    // the module-scoped `ring: RingFlash | null` above — the public
    // `ChartEngine.setOpen` signature (see its docblock) still calls it
    // `ring`; TS's structural typing doesn't require the names to match.
    setOpen(index, value, wantsRing = true) {
      if (index < 0 || index >= open.length) return
      const v = value ? 1 : 0
      if (open[index] === v) return
      open[index] = v
      pendingTransition = true
      pendingTransitionOpening = value
      layoutDirty = true
      // Arm (or replace) the ring candidate, but only when THIS call asked
      // for one. A caller making several `setOpen` calls before the next
      // relayout consumes the candidate — a deep toggle's descendants, or an
      // `expandAll`/`collapseAll` loop — passes `ring: false` for every call
      // that isn't "the one node the user actually acted on", so this simply
      // never runs for those and `pendingRingSource` is left exactly as it
      // was. A second, genuinely separate single toggle (both calls passing
      // the default `ring: true`) that lands before the first one's relayout
      // still naturally REPLACES the candidate rather than queuing a second
      // ring — which is the cap the brief asks for ("only a single ring can
      // be live at a time"), as a side effect of this same assignment rather
      // than a second mechanism.
      if (wantsRing) pendingRingSource = index
    },
    flashRing(index) {
      if (index < 0 || index >= open.length) return
      pendingRingSource = index
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
        // Same switch governs the ring: a reduced-motion host gets no
        // flash, so drop one that's already mid-flight too.
        ring = null
      }
    },
    render,
    get transitioning() {
      return transition !== null
    },
    get transitionStartedAt() {
      return transition === null ? null : transition.startedAt
    },
    get ringActive() {
      return ring !== null
    },
    get boxes() {
      return boxes
    },
    get renderBoxes() {
      return renderBoxes
    },
    get lastDrawnBoxes() {
      return lastDrawnBoxes
    },
    get lastDrawnAlpha() {
      return lastDrawnAlpha
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
    getExportData() {
      if (layoutDirty) relayout(performance.now())
      return {
        boxes,
        parent: prunedParent,
        labels: prunedLabels,
        bounds,
        horizontal: options.orientation === 'lr' || options.orientation === 'rl',
      }
    },
  }
}
