import type { Camera } from '../viewport.js'
import type { LodTier } from './lod.js'

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
  readonly stats: { lastDrawCalls: DrawCallStats }
}
