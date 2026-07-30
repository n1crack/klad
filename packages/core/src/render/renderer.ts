import type { DropMode } from '../drag/drop-target.js'
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
  /** `'left' | 'center' | 'right'` — widened for the same reason `fillStyle`
   * is. Sector and radial labels are centred on a point rather than inset from
   * a box edge, so they set this; every rectangular layout leaves it alone. */
  textAlign: string
  save(): void
  restore(): void
  scale(x: number, y: number): void
  translate(x: number, y: number): void
  /** Radians, clockwise. Used to turn a label to follow the geometry under it —
   * a radial chart's outward-radiating names, a sunburst's along-the-arc
   * labels. Always inside a `save()`/`restore()` pair. */
  rotate(angle: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  /** Used to trace a sunburst sector's two arcs. `counterclockwise` is what
   * lets the inner arc run back the other way so the sector closes into a
   * single ring segment rather than a bow tie. */
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void
  closePath(): void
  /** Used to round the two bends of a connector elbow when `theme.edgeCornerRadius` is
   * greater than 0 — see canvas2d.ts's edge-drawing loop. */
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void
  setLineDash(segments: number[]): void
  lineDashOffset: number
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

/**
 * How a connector between a parent and child is shaped. One per layout — see
 * `layout/index.ts`'s `edgeStyleForLayout` — because the elbow that reads
 * correctly on a tiered chart reads as a mistake on a file list and as noise
 * on a wheel.
 *
 *  - `tiered`   — the orthogonal elbow of the 1.0 chart: out of the parent's
 *                 bottom (or side) edge, across, and into the child's top. The
 *                 only style that honours `Frame.horizontal`.
 *  - `folder`   — the file-explorer spine: straight down the gutter under the
 *                 parent, then a short stub right into each child's left edge.
 *  - `spoke`    — a straight line from the parent's centre to the child's, for
 *                 a radial chart, where the shortest path between two rings IS
 *                 the relationship.
 *  - `bezier`   — the same two ends as `tiered`, joined by a curve instead of
 *                 an elbow. No layout asks for it; it is there for a chart
 *                 that wants a softer line than a right angle, and it honours
 *                 `Frame.horizontal` the way `tiered` does.
 *  - `none`     — no connectors at all. A sunburst's sectors are already
 *                 adjacent to their parent's; a line between them would draw a
 *                 relationship the geometry has already stated.
 */
export type EdgeStyle = 'tiered' | 'folder' | 'spoke' | 'bezier' | 'none'

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
  /** How to shape a connector between a parent and child — see `EdgeStyle`.
   * Fixed by the layout, resolved once per relayout by the engine. */
  edgeStyle: EdgeStyle
  /**
   * Polar geometry for a sunburst — `[cx, cy, innerR, outerR, a0, a1]` per node
   * index, in world units — or `null` for every rectangular layout. When
   * present the renderer draws sectors INSTEAD of boxes; `boxes` still holds
   * each sector's bounding box, and is still what the cull in `visible` was
   * computed against.
   *
   * Interpolated during a focus transition, unlike `boxes`: a wheel drilling in
   * has to travel in polar space, because linearly interpolating the corners of
   * a sector's bounding box does not describe any arc along the way.
   */
  sectors: Float64Array | null
  /**
   * Per-node outward angle in radians for a radial chart, so a label can be
   * turned to run along its own ray; `null` for every layout whose text is
   * horizontal. Not interpolated — where a label points is settled by the
   * layout, not by a transition.
   */
  angles: Float64Array | null
  /**
   * World-unit room the layout reserved outside each node for its label — see
   * `LayoutResult.labelSpace`. `0` for every layout whose text sits inside the
   * node box, which is all of them but `radial`.
   */
  labelSpace: number
  /**
   * 1 per node that HAS children, none of which are on screen — `null` when
   * nothing is hiding anything, which is the whole steady state of a fully
   * expanded chart.
   *
   * It exists because the two layouts that draw their own nodes have no room
   * for a disclosure control: a radial marker is a dot, and a sunburst
   * segment is a slice of a ring. Without a mark, a collapsed branch there
   * looks exactly like a leaf — the chart simply omits the fact that there is
   * more, which is worse than showing less.
   *
   * "Not on screen" covers both reasons a wheel has: the branch is closed, or
   * its children fell outside the ring window. They are one question to a
   * viewer, so they get one answer. The engine works it out per relayout; see
   * the block that fills it.
   */
  hasHidden: Uint8Array | null
  /**
   * Which branch each node belongs to, as the node index of its own top-level
   * ancestor (`-1` for a root itself) — and how deep it sits below that
   * ancestor. Together these are everything `render/palette.ts` needs to give a
   * node its colour. `null` on both for a layout that does not colour by
   * branch, which is the whole steady state of an ordinary org chart.
   *
   * Deliberately the STRUCTURE rather than the finished colours. Colour is a
   * paint concern: `setTheme` is documented as paint-only and must not be able
   * to trigger a relayout, which is exactly what an engine that had baked the
   * palette into a string per node would be forced into on every theme change.
   * These two arrays depend only on the tree, so the engine computes them once
   * per relayout and a theme swap re-derives colours from them for free.
   *
   * A highlighted or selected node still wins over the branch colour: an accent
   * means "the chart is answering you", and a branch colour is ambient.
   */
  branchOf: Int32Array | null
  branchDepth: Int32Array | null
  /**
   * True for `lr`/`rl`. Connectors elbow along the tree's growth axis, which is
   * horizontal for those orientations and vertical otherwise — splitting on the
   * wrong axis makes the routing cross through node boxes.
   */
  horizontal: boolean
  /**
   * True when the chart reads right-to-left. Only the `folder` connector style
   * consults it — its spine drops under the row's leading edge, and which edge
   * that is flips with the reading direction. Every other style is already
   * mirrored by the time it gets here, because `applyOrientation` mirrored the
   * BOXES the anchors are derived from.
   */
  rtl: boolean
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
   * The node a drop would land on right now, or `-1` when nothing is being
   * dragged over anything.
   *
   * Drawn as a preview of the result, not as a hover state: `into` outlines
   * the target, `before`/`after` draw an insertion line along the edge the
   * node would arrive at. A drag that only lit up whatever was under the
   * pointer would leave the viewer to guess which of the three a drop means,
   * and the whole point of the edge bands is that they mean different things.
   */
  dropIndex: number
  dropMode: DropMode
  /**
   * False when the drop under the pointer would be refused — the target is
   * inside the subtree being dragged. Drawn in the refusal colour rather than
   * simply not drawn: "nothing happens here" and "you are pointing at nothing"
   * look identical when the answer is an absence, and only one of them is
   * true.
   */
  dropValid: boolean
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
  /**
   * Which connectors flow, by CHILD index in the pruned space — an edge is
   * named by the node it arrives at, since every node has exactly one parent.
   * `null` when none do, which is the common case and costs nothing.
   *
   * A mask rather than a per-edge callback because the edges are drawn as one
   * batched path per treatment: a stroke style belongs to a path, so each
   * distinct look is a pass, and a small fixed number of passes is affordable
   * where an arbitrary per-edge colour is not.
   */
  edgeFlow: Uint8Array | null
  /**
   * The clock, in seconds, for advancing the dash pattern.
   *
   * Handed over rather than read here, for the same reason `ringProgress` is
   * computed upstream: a frame has to be a pure function of its inputs. The
   * renderer turns it into an offset using its own `edgeFlowDash` and
   * `edgeFlowSpeed`, because both are theme tokens and the theme lives on
   * this side. An export ignores it, which is why the SVG's dashes stand
   * still.
   */
  edgeFlowSeconds: number
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
