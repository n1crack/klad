import type { Tree } from '../tree.js'
import type { Bounds } from '../types.js'

export interface LayoutOptions {
  /** Minimum horizontal gap between adjacent boxes (tidy). */
  spacingX: number
  /** Vertical gap between a node's bottom edge and its children's top edge (tidy). */
  spacingY: number
  /**
   * Per-level step, in world units — what "one level deeper" costs. Its meaning
   * is per-layout because the layouts disagree about which axis depth travels
   * along, and a single well-named knob beats three near-identical ones:
   *
   *  - `file`: horizontal indent added per depth level.
   *  - `radial` / `sunburst`: radial distance between consecutive rings.
   *
   * Omitted, each layout derives a value from the node sizes it was handed, so
   * the step scales with how big the cards actually are. Ignored by `tidy`.
   */
  step?: number | undefined
  /**
   * `file` only: vertical gap between consecutive rows. Defaults to
   * `spacingY`. Ignored by every other layout.
   */
  rowGap?: number | undefined
  /**
   * `sunburst` only: what each node is worth, in PRUNED index space, or `null`
   * for "every node counts as one". A parent's own entry is ignored — its
   * share is the sum of what is under it, which is the only definition under
   * which a ring is exactly the union of the ring outside it.
   */
  weights?: Float64Array | null | undefined
  /**
   * `sunburst` only: the node the wheel is currently centred on, as an index
   * into `tree`, or `-1` for the whole forest (the default).
   *
   * This is a LAYOUT parameter, not a filter: every node still gets a sector.
   * The focused node becomes the centre hub, its descendants fan out into the
   * rings around it, its ancestors collapse into the hub, and everything
   * outside its branch is given a zero-width wedge — which is what lets a
   * focus change animate as "the rest of the wheel closes radially while the
   * chosen branch opens up" rather than as a cut to a different chart. See
   * `sunburst`'s docblock.
   *
   * Deliberately NOT `isolate`: isolating prunes the tree and relayouts in a
   * new index space, so the nodes that leave have nowhere to animate FROM.
   */
  focus?: number | undefined
  /**
   * `sunburst` only: how many rings below the focus are drawn, beyond the hub
   * itself. Anything deeper is given a zero-width wedge, exactly like an
   * out-of-focus branch, so drilling in reveals it rather than re-scaling the
   * whole wheel. Defaults to 3 — deep enough to show a branch's shape, shallow
   * enough that the outermost ring is still thick enough to carry a label.
   */
  maxRings?: number | undefined
}

export interface LayoutResult {
  /** [x, y, w, h] per node; node i occupies boxes[i * 4 .. i * 4 + 3]. */
  boxes: Float64Array
  bounds: Bounds
  /**
   * Optional annular-sector geometry, for a layout that draws its nodes as arc
   * segments rather than rectangles (the sunburst). `[cx, cy, innerR, outerR,
   * a0, a1]` per node.
   *
   * When present, `boxes` still holds each sector's axis-aligned bounding box,
   * so culling, the minimap and every other box-shaped consumer keep working
   * untouched — only the renderer and the hit-test read `sectors`. Absent for
   * every rectangular layout.
   */
  sectors?: Float64Array | undefined
  /**
   * Optional per-node facing angle, in radians, for a layout that wants its
   * labels turned to follow the geometry (`radial`'s outward-radiating labels).
   * Absent for every layout whose text is simply horizontal.
   */
  angles?: Float64Array | undefined
  /**
   * Room, in world units, that this layout reserved OUTSIDE its nodes for
   * their labels — `radial`'s outward-radiating names. Absent (and meaningless)
   * for a layout whose text sits inside the node box.
   *
   * It has to come from the layout because the layout is what decided it: the
   * bounds already include this allowance, and a renderer that guessed a
   * different number would either truncate names the frame has room for or
   * draw ones that run outside it and get clipped by `fit()`. Guessing from
   * the node's own width is the specific trap — the natural way to use a
   * radial chart is a small marker with the LABEL carrying the content, and
   * then the node's width is a dot's width.
   */
  labelSpace?: number | undefined
}

/**
 * A layout algorithm: given a normalized tree and each node's [w, h] pair,
 * produce a canonical top-down, left-to-right box per node plus the overall
 * bounds. Orientation and RTL are applied afterwards, by the engine, and only
 * to the layouts that have an opinion about them — they are NOT this
 * function's concern. The origin is normalised to (0, 0).
 *
 * Pure: same inputs, same output, no clock and no state. That is what lets the
 * engine run one inside a Web Worker and the export path run the same one on
 * the main thread without the two disagreeing.
 */
export type LayoutFn = (tree: Tree, sizes: Float64Array, opts: LayoutOptions) => LayoutResult
