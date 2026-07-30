import type { Tree } from '../tree.js'
import type { LayoutOptions, LayoutResult } from './types.js'

const TAU = Math.PI * 2

/**
 * Fraction of each subdivision reserved as a gap between sibling subtrees. The
 * children of a node are packed into the inner `1 - GAP_FRAC` of its wedge and
 * centred, so adjacent subtrees pull apart from their shared boundary instead
 * of butting up against it. Points, not just wedges, move — a node's angle is
 * the centre of its (now inset) wedge — so this actually separates the drawn
 * nodes, which a pure wedge gap would not.
 */
const GAP_FRAC = 0.12

/**
 * Ring spacing when `opts.step` is omitted: the LARGEST node's bigger side plus
 * a fifth for air, so consecutive generations are guaranteed to clear each
 * other radially (a mean-based value lets one big node on an inner ring reach
 * into the next). O(n), one pass; floored at 1 so an all-zero-size input can't
 * collapse every ring onto the centre.
 */
function deriveRing(sizes: Float64Array, n: number): number {
  let max = 0
  for (let i = 0; i < n; i++) {
    const w = sizes[i * 2]!
    const h = sizes[i * 2 + 1]!
    const side = w > h ? w : h
    if (side > max) max = side
  }
  const ring = max * 1.2
  return ring > 1 ? ring : 1
}

/** The widest declared node, used as the default outward label allowance. */
function maxWidth(sizes: Float64Array, n: number): number {
  let max = 0
  for (let i = 0; i < n; i++) {
    const w = sizes[i * 2]!
    if (w > max) max = w
  }
  return max
}

/**
 * Radial (concentric-ring) layout: the root at the centre, each generation on a
 * ring `step` further out, and each subtree owning an angular wedge sized by
 * how many leaves it holds — so sibling subtrees never overlap in angle and a
 * bushy branch gets proportionally more of the circle than a sparse one. For
 * trees that are wide and shallow this uses space a tiered layout can't.
 *
 * Node boxes are the node's own declared size, centred on its polar point, and
 * stay axis-aligned: it is the LABEL that turns, not the card. `angles` carries
 * each node's outward ray angle so the renderer can lay its text along that ray
 * (flipping it on the left-hand side of the wheel, so nothing reads upside
 * down) — see `render/canvas2d.ts`. Keeping the card axis-aligned is what lets
 * every existing box-shaped consumer — culling, the minimap, hit-testing, the
 * DOM overlay — go on working with no notion that this layout is polar at all.
 *
 * Bounds are the SQUARE inscribing the outermost ring plus a label allowance,
 * with the root at its exact centre. Deliberately not the tight bbox of the
 * cards: a radial chart is read from its centre, so the root belongs in the
 * middle of the frame rather than wherever the widest branch happens to leave
 * it.
 *
 * `opts.step` sets the ring spacing; omitted, it is derived from the node
 * sizes. `spacingX`/`spacingY`/`rowGap` are unused. Rectangular cards on an
 * inner ring can still crowd — radial is a wide-shallow tool, not a dense-tree
 * one — so this makes no overlap guarantee, unlike `tidy`.
 *
 * Never recurses — flat passes over `order`.
 */
export function radial(tree: Tree, sizes: Float64Array, opts: LayoutOptions): LayoutResult {
  const n = tree.count
  const boxes = new Float64Array(n * 4)
  const angles = new Float64Array(n)
  if (n === 0) {
    return { boxes, angles, labelSpace: 0, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  }

  const { order, depth, childStart, childIndex, roots, parent } = tree

  // Leaf count per subtree, in reverse preorder (every child before its parent).
  const leaves = new Float64Array(n)
  for (let k = n - 1; k >= 0; k--) {
    const i = order[k]!
    if (childStart[i]! === childStart[i + 1]!) leaves[i] = 1
    const p = parent[i]!
    if (p !== -1) leaves[p]! += leaves[i]!
  }

  const ring = opts.step ?? deriveRing(sizes, n)

  let totalLeaves = 0
  for (let r = 0; r < roots.length; r++) totalLeaves += leaves[roots[r]!]!

  // Angular interval [a0, a1) per node. Roots partition the full circle by
  // their leaf counts; then each node partitions its own wedge among its
  // children. Starting at -PI/2 puts the first branch at 12 o'clock and fans
  // the rest clockwise, which is how a viewer expects to read a wheel.
  const a0 = new Float64Array(n)
  const a1 = new Float64Array(n)
  let cursor = -Math.PI / 2
  for (let r = 0; r < roots.length; r++) {
    const root = roots[r]!
    const span = (leaves[root]! / totalLeaves) * TAU
    a0[root] = cursor
    a1[root] = cursor + span
    cursor += span
  }
  for (let k = 0; k < n; k++) {
    const i = order[k]!
    const from = childStart[i]!
    const to = childStart[i + 1]!
    const full = a1[i]! - a0[i]!
    const li = leaves[i]!
    // Pack the children into the inner (1 - GAP_FRAC) of this node's wedge,
    // centred, leaving a gap on each side that separates this subtree's fan
    // from its siblings'. A full-circle wedge (the lone root) is never inset —
    // a gap there would just be a seam in an otherwise continuous ring.
    const inset = full >= TAU - 1e-9 ? 0 : full * GAP_FRAC
    const usable = full - inset
    let c = a0[i]! + inset / 2
    for (let j = from; j < to; j++) {
      const ch = childIndex[j]!
      const s = (leaves[ch]! / li) * usable
      a0[ch] = c
      a1[ch] = c + s
      c += s
    }
  }

  // The radius the whole wheel fits inside: the outermost ring, plus room for
  // that ring's outward-radiating labels.
  //
  // The label allowance is the larger of the widest declared node and most of
  // one ring's spacing. Taking the node width alone breaks the moment a host
  // draws its nodes as small markers and lets the LABEL carry the content —
  // which is the natural way to use this layout — since the allowance would
  // then be a dot's width and every name on the outer ring would run outside
  // the bounds and be cut off by `fit()`. Ring spacing is the better proxy: it
  // is already scaled to the content, and it is the one number a host tunes
  // (`opts.step`) when this layout feels too tight or too loose.
  let maxDepth = 0
  for (let i = 0; i < n; i++) if (depth[i]! > maxDepth) maxDepth = depth[i]!
  const widest = maxWidth(sizes, n)
  const label = Math.max(widest, ring * 0.75)
  const radius = maxDepth * ring + label

  for (let i = 0; i < n; i++) {
    const angle = (a0[i]! + a1[i]!) / 2
    const r = depth[i]! * ring
    const w = sizes[i * 2]!
    const h = sizes[i * 2 + 1]!
    const o = i * 4
    // Centred on the polar point, then shifted so the root lands at (radius,
    // radius) — the middle of the square below.
    boxes[o] = radius + r * Math.cos(angle) - w / 2
    boxes[o + 1] = radius + r * Math.sin(angle) - h / 2
    boxes[o + 2] = w
    boxes[o + 3] = h
    // A node at radius 0 — the root — sits ON the centre and has no outward
    // ray, so there is no direction for its name to run in. `NaN` says exactly
    // that, and the renderer answers it by drawing the label horizontally,
    // centred on the node, the way the middle of a wheel should be labelled.
    // The alternative (leaving the wedge's mid-angle in place) rotates the
    // root's name by whatever half of a full turn happens to come to — 90°,
    // in the common single-root case, so the one label a viewer reads first
    // arrives sideways.
    angles[i] = r === 0 ? Number.NaN : angle
  }

  return {
    boxes,
    angles,
    labelSpace: label,
    bounds: { minX: 0, minY: 0, maxX: 2 * radius, maxY: 2 * radius },
  }
}
