import type { Camera } from '../viewport.js'
import type { LodTier } from './lod.js'
import type { Theme } from './theme.js'

/**
 * The slice of the canvas 2D API this renderer uses, declared structurally.
 * `packages/core` compiles with `types: []` and `lib: ["ES2023"]`, so it has no
 * `lib.dom` — and it must not gain one, because that would also make `window`
 * and `document` resolvable inside worker-bound code. A real `HTMLCanvasElement`
 * and an `OffscreenCanvas` both satisfy these shapes.
 */
export interface RenderContext2D {
  /**
   * Widened to `unknown` deliberately. The real DOM type is
   * `string | CanvasGradient | CanvasPattern`; declaring `string` here would make
   * an actual `CanvasRenderingContext2D` fail to satisfy this interface, which
   * defeats the point of describing it structurally. These are only ever written
   * to, never read, so `unknown` costs nothing.
   */
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  font: string
  globalAlpha: number
  textBaseline: string
  save(): void
  restore(): void
  scale(x: number, y: number): void
  translate(x: number, y: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  /** Used to round the two bends of a connector elbow when `theme.edgeCornerRadius` is
   * greater than 0 — see canvas2d.ts's edge-drawing loop. */
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  roundRect(x: number, y: number, w: number, h: number, radii: number): void
  rect(x: number, y: number, w: number, h: number): void
  fill(): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
}

export interface RenderSurface {
  width: number
  height: number
  getContext(id: '2d'): RenderContext2D | null
}

/** Everything the renderer needs for one frame. Nothing is derived internally. */
export interface Frame {
  /** [x, y, w, h] per node, in world units. */
  boxes: Float64Array
  /** Parent index per node, -1 for roots. Used to draw connectors. */
  parent: Int32Array
  /**
   * Node indices to draw. `visible[0, visibleCount)` are nodes whose own box
   * overlaps the viewport — draw their fill, stroke, and label. Nothing
   * beyond `visibleCount` is meaningful.
   */
  visible: Uint32Array
  visibleCount: number
  /**
   * CHILD indices whose connector to `parent[i]` is to be drawn —
   * `edges[0, edgeCount)`. This is an INDEPENDENT set from `visible`, not a
   * superset or subset of it: a connector's own bounding box (the rectangle
   * spanned by its parent's exit point and its child's entry point) can
   * cross the viewport while neither endpoint's own box does — an elbow's
   * cross-axis leg is not bounded by either node's size, unlike the
   * growth-axis distance between a direct parent and child. Symmetrically, a
   * node's own box can graze the viewport somewhere its connector's anchor
   * points never reach. The engine indexes connector boxes separately from
   * node boxes for exactly this reason; see `engine.ts`'s `buildEdgeIndex`.
   * Nothing beyond `edgeCount` is meaningful.
   */
  edges: Uint32Array
  edgeCount: number
  /** Label per node index. May be empty when the tier draws no text. */
  labels: readonly string[]
  camera: Camera
  dpr: number
  tier: LodTier
  /**
   * True for `lr`/`rl`. Connectors elbow along the tree's growth axis, which is
   * horizontal for those orientations and vertical otherwise — splitting on the
   * wrong axis makes the routing cross through node boxes.
   */
  horizontal: boolean
  /** 1 per highlighted node index, or null when nothing is highlighted. */
  highlight: Uint8Array | null
  /**
   * 1 per SELECTED node index, or null when nothing is selected. Keyed the
   * same way as `highlight`, and separate from it for the reason
   * `theme.selectionStroke` is separate from `highlightStroke`: the two say
   * different things and co-occur.
   */
  selected: Uint8Array | null
  /** Node currently being dragged, or -1. Drawn with reduced alpha. */
  dragIndex: number
  /**
   * Per-SLOT opacity override for `visible[0, visibleCount)` — `revealAlpha[n]`
   * pairs with `visible[n]`, unlike `highlight` which is keyed by pruned
   * index. `null` in the common case (no expand/collapse transition is
   * affecting opacity this frame); when present, only nodes newly revealed by
   * an in-progress expand carry a value below `1`.
   */
  revealAlpha: Float32Array | null
  /**
   * Nodes removed by an in-progress collapse, still shrinking/fading toward
   * the ancestor that swallowed them. `[x, y, w, h]` per ghost at
   * `ghostBoxes[i * 4 .. i * 4 + 3]` (world units, same convention as
   * `boxes`); `ghostAlpha[i]` is its opacity. Only the first `ghostCount`
   * entries are meaningful. No connector or label is drawn for a ghost.
   */
  ghostBoxes: Float64Array
  ghostAlpha: Float32Array
  ghostCount: number
  /**
   * True while a one-shot expand/collapse confirmation ring is being drawn
   * this frame — a brief outline flash around the node a `setOpen` toggle
   * just acted on. When false, `ringBox`/`ringProgress` are meaningless.
   * Never true while animation is disabled, or for a `setOpen` call whose
   * caller explicitly opted it out of the ring (a deep toggle's descendants,
   * or an `expandAll`/`collapseAll` burst) — see engine.ts's
   * `setOpen`/`relayout` for how that's decided.
   */
  ringActive: boolean
  /**
   * `[x, y, w, h]` of the ringed node this frame, in world units — the same
   * convention as `boxes`, and following the same interpolated position as
   * the node itself during a layout transition (never a stale snapshot of
   * the final layout while the node glides elsewhere).
   */
  ringBox: Float64Array
  /**
   * 0 (just fired) to 1 (fully faded) progress through the one-shot flash,
   * a pure function of the `now` passed to `render()` — never a renderer-
   * side clock read. The renderer derives both the outward growth and the
   * fade-out alpha from this single number.
   */
  ringProgress: number
}

export interface DrawCallStats {
  /** Stroke calls spent on edges. Batching keeps this at 1 for any node count. */
  edgeStrokes: number
  /** Nodes drawn. */
  nodes: number
  /** Labels drawn. */
  labels: number
}

export interface Renderer {
  /** `width`/`height` are CSS pixels; the backing store is scaled by `dpr`. */
  resize(width: number, height: number, dpr: number): void
  draw(frame: Frame): void
  /**
   * Swaps the theme this renderer paints with, effective from the next
   * `draw()` call. Paint-only: the renderer never derives layout or hit-test
   * geometry from theme tokens (that stays entirely in the engine's `Frame`),
   * so this cannot trigger a relayout or re-cull — it just changes which
   * colours/radii the very next frame's fills/strokes use.
   */
  setTheme(theme: Theme): void
  readonly stats: { lastDrawCalls: DrawCallStats }
}
