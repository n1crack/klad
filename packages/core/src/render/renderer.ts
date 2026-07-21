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
  fillStyle: string
  strokeStyle: string
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
  /** Indices to draw; only the first `visibleCount` entries are read. */
  visible: Uint32Array
  visibleCount: number
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
