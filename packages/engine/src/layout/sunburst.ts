import type { Tree } from '../tree.js'
import type { LayoutOptions, LayoutResult } from './types.js'

const TAU = Math.PI * 2

/**
 * The hub is this many rings across, rather than one. It is the single most
 * clicked target on the whole wheel — it is what "go back up a level" means —
 * and a one-ring hub is a small dot that is easy to miss and land on a child
 * ring instead. It also has to carry the focused node's own label at a
 * readable size, which a ring-thin disc cannot.
 */
const HUB = 1.7

/** Default for `opts.maxRings` — see `LayoutOptions.maxRings`. */
const DEFAULT_MAX_RINGS = 3

/** Where angle 0 sits. 12 o'clock, so the first branch starts where a viewer
 * starts reading and the rest fan out clockwise. */
const START_ANGLE = -Math.PI / 2

/**
 * A wedge narrower than this is treated as closed — see the snap in the main
 * loop for what produces one. Around a thousandth of a pixel at a radius of a
 * million, so nothing this closes could have been drawn. Kept in step with
 * `MIN_SECTOR_ANGLE` in `render/sector.ts`, which guards the same thing on the
 * drawing side; they are separate constants because layout must not import
 * from render (`layout/index.ts` already imports the other way).
 */
const CLOSED_ANGLE = 1e-9

/**
 * Polar hit-test over sunburst sectors: returns the position (into the sectors
 * array, i.e. the pruned node index) of the sector containing `(worldX,
 * worldY)`, or -1.
 *
 * Radius picks the ring, angle the wedge; sectors never overlap, so the first
 * match is the only match. Zero-width and zero-thickness sectors — the
 * collapsed out-of-focus and out-of-range nodes — can never match, so a click
 * on empty space stays a miss.
 *
 * Shared by the engine AND the worker host rather than living inside the
 * engine: in worker mode the host runs its own hit-test on the main thread and
 * never calls the engine's, so both need to reach the same function or the two
 * paths disagree about what was clicked.
 */
export function hitTestSector(sectors: Float64Array, count: number, worldX: number, worldY: number): number {
  for (let p = 0; p < count; p++) {
    const o = p * 6
    const innerR = sectors[o + 2]!
    const outerR = sectors[o + 3]!
    const a0 = sectors[o + 4]!
    const a1 = sectors[o + 5]!
    if (outerR - innerR <= 0 || a1 - a0 <= 0) continue // collapsed; not on screen
    const dx = worldX - sectors[o]!
    const dy = worldY - sectors[o + 1]!
    const r = Math.hypot(dx, dy)
    if (r < innerR || r > outerR) continue
    if (a1 - a0 >= TAU - 1e-9) return p // full circle (the hub)
    const ang = Math.atan2(dy, dx)
    // `atan2` returns (-PI, PI]; the wedges run from START_ANGLE (-PI/2) up to
    // START_ANGLE + TAU, so test the angle in both turns it could be expressed
    // in — a wedge past PI is only reachable via the second.
    if ((ang >= a0 && ang <= a1) || (ang + TAU >= a0 && ang + TAU <= a1)) return p
  }
  return -1
}

/**
 * Ring thickness when `opts.step` is omitted: 1.2x the mean node height, so a
 * ring comes out about as thick as a card is tall. Floored at 1.
 */
function deriveRing(sizes: Float64Array, n: number): number {
  let total = 0
  for (let i = 0; i < n; i++) total += sizes[i * 2 + 1]!
  const r = (total / n) * 1.2
  return r > 1 ? r : 1
}

/**
 * Axis-aligned bounding box of the annular sector [r0,r1] x [a0,a1], written
 * into `out` as [minX, minY, maxX, maxY]. A correct superset: the extremes are
 * at the four corners, plus wherever the outer arc crosses a cardinal axis
 * (where |cos| or |sin| hits 1), so those crossings are added when they fall
 * inside the wedge. Used for culling, the minimap and the quadtree, all of
 * which only need a box that CONTAINS the drawn sector.
 */
function sectorBBox(r0: number, r1: number, a0: number, a1: number, out: Float64Array): void {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const consider = (x: number, y: number): void => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  consider(r0 * Math.cos(a0), r0 * Math.sin(a0))
  consider(r0 * Math.cos(a1), r0 * Math.sin(a1))
  consider(r1 * Math.cos(a0), r1 * Math.sin(a0))
  consider(r1 * Math.cos(a1), r1 * Math.sin(a1))
  // Cardinal directions the outer arc sweeps through — the axis extremes. The
  // wedge can sit anywhere on the turn, so each cardinal is tested in the two
  // turns it could fall in.
  for (let c = -4; c < 8; c++) {
    const ck = (c * Math.PI) / 2
    if (ck >= a0 && ck <= a1) consider(r1 * Math.cos(ck), r1 * Math.sin(ck))
  }
  out[0] = minX
  out[1] = minY
  out[2] = maxX
  out[3] = maxY
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Sunburst layout: the tree as a wheel. The focused node is the centre disc,
 * each generation below it is a ring further out, and every node is an annular
 * sector whose angular span is its share of the circle by leaf count — so a
 * parent's arc exactly spans the union of its children's, and the containment
 * you would read down a file tree you read outward around the circle instead.
 *
 * ## Focus, and why it is a layout parameter
 *
 * `opts.focus` names the node the wheel is centred on. Everything is expressed
 * RELATIVE to it:
 *
 *  - the focused node becomes the hub — a full circle at the centre;
 *  - its descendants fan out into rings 1..`maxRings` around it, with its own
 *    wedge stretched to the whole turn, so drilling in magnifies the branch;
 *  - its ancestors collapse to a zero-radius point at the centre;
 *  - anything outside its branch, or deeper than `maxRings`, gets a ZERO-WIDTH
 *    wedge rather than being removed.
 *
 * That last point is the whole reason focus lives here rather than being
 * implemented as `isolate`. Isolating prunes the tree and relayouts in a fresh
 * index space, so the nodes that leave have no "before" and no "after" — they
 * can only cut. Because every node still gets a sector here, a focus change is
 * an ordinary geometry change from one full layout to another, and the engine
 * can interpolate between the two: the branch you picked opens up and travels
 * inward while everything else closes radially at the seam. Nothing is
 * re-rooted and nothing is pruned.
 *
 * The out-of-branch collapse needs no special case, incidentally — mapping the
 * focus's wedge onto the full turn already sends every other wedge outside
 * [0, TAU], and clamping is what makes it zero-width, at the seam it should
 * close toward.
 *
 * ## Fixed frame
 *
 * The outer radius is `HUB + maxRings` rings regardless of which node is
 * focused, and the bounds are the square that circle inscribes, with the hub at
 * its exact centre. So the frame does not change when the focus does: the
 * camera has nothing to chase and the centre of the wheel stays nailed to the
 * same pixel through the whole drill-down. A tight bbox would move under it on
 * every click, which is the single thing that makes a zoomable sunburst feel
 * broken.
 *
 * Alongside the usual `boxes` (each the axis-aligned bounding box of the node's
 * sector, so culling, the minimap and the quadtree keep working untouched) this
 * returns `sectors`: `[cx, cy, innerR, outerR, a0, a1]` per node, which the
 * renderer draws as arc segments and `hitTestSector` resolves clicks against.
 *
 * `opts.step` sets the ring thickness; `spacingX`/`spacingY`/`rowGap` are
 * unused. Orientation and RTL do not apply — a wheel is symmetric.
 *
 * Never recurses — flat passes over `order`.
 */
export function sunburst(tree: Tree, sizes: Float64Array, opts: LayoutOptions): LayoutResult {
  const n = tree.count
  const boxes = new Float64Array(n * 4)
  const sectors = new Float64Array(n * 6)
  if (n === 0) {
    return { boxes, sectors, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  }

  const { order, depth, childStart, childIndex, roots, parent } = tree

  // --- 1. The BASE partition: every node's share of the full turn, ignoring
  // focus entirely. Focus is applied as a transform of this, below, so that a
  // change of focus never re-derives the tree's own proportions.
  //
  // A leaf is worth one, or whatever `weights` says it is worth — a file's
  // size, a budget line, a population. Everything above a leaf is the sum of
  // what is under it either way, which is what keeps a ring exactly the union
  // of the ring outside it; a parent's OWN weight is deliberately ignored, so
  // a folder whose declared size disagrees with its contents cannot make its
  // children overflow their own arc.
  //
  // A zero-weight leaf gets a zero-width sector and disappears, which is
  // correct — nothing is nothing. A tree where NOTHING has a weight is a
  // different case: dividing by that total is a division by zero, and the
  // honest reading of "no node is worth anything" is that no node is worth
  // more than another, so it falls back to counting them (below).
  const weights = opts.weights ?? null
  const leaves = new Float64Array(n)
  for (let k = n - 1; k >= 0; k--) {
    const i = order[k]!
    if (childStart[i]! === childStart[i + 1]!) {
      const w = weights === null ? 1 : weights[i]!
      leaves[i] = w > 0 ? w : 0
    }
    const p = parent[i]!
    if (p !== -1) leaves[p]! += leaves[i]!
  }
  let totalLeaves = 0
  for (let r = 0; r < roots.length; r++) totalLeaves += leaves[roots[r]!]!
  if (totalLeaves === 0) {
    leaves.fill(0)
    for (let k = n - 1; k >= 0; k--) {
      const i = order[k]!
      if (childStart[i]! === childStart[i + 1]!) leaves[i] = 1
      const p = parent[i]!
      if (p !== -1) leaves[p]! += leaves[i]!
    }
    for (let r = 0; r < roots.length; r++) totalLeaves += leaves[roots[r]!]!
  }

  const baseA0 = new Float64Array(n)
  const baseA1 = new Float64Array(n)
  let cursor = 0
  for (let r = 0; r < roots.length; r++) {
    const root = roots[r]!
    const span = (leaves[root]! / totalLeaves) * TAU
    baseA0[root] = cursor
    baseA1[root] = cursor + span
    cursor += span
  }
  // Tiling, no gaps — the rings are continuous and a parent's arc is exactly
  // the union of its children's. The visual separation between neighbours is
  // the renderer's job (a surface-coloured gap), not the layout's: a gap baked
  // into the angles would make the containment a lie.
  for (let k = 0; k < n; k++) {
    const i = order[k]!
    const from = childStart[i]!
    const to = childStart[i + 1]!
    const width = baseA1[i]! - baseA0[i]!
    const li = leaves[i]!
    let c = baseA0[i]!
    for (let j = from; j < to; j++) {
      const ch = childIndex[j]!
      // `li` is zero only when everything under this node weighs nothing, in
      // which case `width` is zero too and every child gets a zero arc — the
      // guard is against `0 / 0`, which would put a `NaN` angle on the frame
      // and take the whole ring with it.
      const s = li > 0 ? (leaves[ch]! / li) * width : 0
      baseA0[ch] = c
      baseA1[ch] = c + s
      c += s
    }
  }

  // --- 2. Resolve the focus. `-1` on a single-rooted tree means that root —
  // the natural centre — so the default view and "focus the root" are the same
  // layout rather than two that differ by one ring. On a forest there is no
  // single node to put in the middle, so the hub is left empty (a virtual
  // super-root spanning the whole turn) and the roots take ring 1.
  const requested = opts.focus ?? -1
  const focus = requested === -1 && roots.length === 1 ? roots[0]! : requested
  const valid = focus >= 0 && focus < n

  const focusA0 = valid ? baseA0[focus]! : 0
  const focusA1 = valid ? baseA1[focus]! : TAU
  const focusSpan = focusA1 - focusA0
  // A focused node with no angular width of its own (possible only in a
  // degenerate tree) would divide by zero; fall back to the whole turn, which
  // renders as the un-drilled view rather than as NaN geometry.
  const scale = focusSpan > 1e-12 ? TAU / focusSpan : 1
  // Depth of the hub. The virtual super-root of a forest sits one above the
  // roots, at -1.
  const hubDepth = valid ? depth[focus]! : -1

  // --- 3. Radii. Constant for a given tree, whatever the focus — see the
  // "Fixed frame" note above.
  const ring = opts.step ?? deriveRing(sizes, n)
  const maxRings = Math.max(1, Math.round(opts.maxRings ?? DEFAULT_MAX_RINGS))
  const hubR = ring * HUB
  const outerMost = hubR + maxRings * ring

  /** Inner and outer radius for a node `rd` rings below the hub. */
  const radiiFor = (rd: number): [number, number] => {
    if (rd < 0) return [0, 0] // an ancestor of the focus: a point at the centre
    if (rd === 0) return [0, hubR] // the hub itself
    if (rd > maxRings) return [outerMost, outerMost] // beyond the window
    return [hubR + (rd - 1) * ring, hubR + rd * ring]
  }

  const bb = new Float64Array(4)
  for (let i = 0; i < n; i++) {
    const rd = depth[i]! - hubDepth
    const [innerR, outerR] = radiiFor(rd)
    // Map this node's base wedge through the focus wedge, then clamp. The
    // focus itself maps exactly onto [0, TAU]; a node inside its branch lands
    // somewhere within that; one outside lands wholly beyond an end and clamps
    // to zero width AT that end — the seam it should close toward. Both seams
    // are the same direction on the circle (START_ANGLE and START_ANGLE + TAU),
    // so every out-of-branch node closes at the same place regardless of which
    // side of the focus it sat on.
    //
    // `baseA0 <= baseA1` and `scale > 0`, so `lo <= hi` needs no check.
    const lo = START_ANGLE + clamp((baseA0[i]! - focusA0) * scale, 0, TAU)
    let hi = START_ANGLE + clamp((baseA1[i]! - focusA0) * scale, 0, TAU)
    // Snap a float-residue sliver shut.
    //
    // `focusSpan * (TAU / focusSpan)` is not exactly `TAU`, so the focused
    // node's upper edge lands an ulp short of the seam and the sibling right
    // after it — which should clamp to zero width — keeps a wedge of about
    // 1e-15 radians. Invisible as a fill, and very visible as everything
    // else: it still takes the sector-gap stroke (a hairline spoke out of the
    // centre), and since its inner radius is zero anything reading its
    // geometry loosely calls it the hub and writes its label across the
    // middle of the wheel, over the label that belongs there.
    //
    // Fixed here, at the source, rather than only guarded at draw time: the
    // hit-test reads these numbers too, and a sector that is closed should be
    // closed for every consumer. `render/sector.ts`'s `isSectorVisible` keeps
    // the same guard on the drawing side, for geometry from any other
    // producer.
    if (hi - lo < CLOSED_ANGLE) hi = lo

    const o6 = i * 6
    sectors[o6] = outerMost // shared centre, at the middle of the square
    sectors[o6 + 1] = outerMost
    sectors[o6 + 2] = innerR
    sectors[o6 + 3] = outerR
    sectors[o6 + 4] = lo
    sectors[o6 + 5] = hi

    sectorBBox(innerR, outerR, lo, hi, bb)
    const o4 = i * 4
    boxes[o4] = bb[0]! + outerMost
    boxes[o4 + 1] = bb[1]! + outerMost
    boxes[o4 + 2] = bb[2]! - bb[0]!
    boxes[o4 + 3] = bb[3]! - bb[1]!
  }

  return { boxes, sectors, bounds: { minX: 0, minY: 0, maxX: 2 * outerMost, maxY: 2 * outerMost } }
}
