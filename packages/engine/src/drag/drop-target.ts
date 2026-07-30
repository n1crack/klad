import type { LayoutName } from '../layout/index.js'
import type { Tree } from '../tree.js'

/**
 * What a drop at a given position would MEAN.
 *
 * A tree reparent is not one gesture but three, and a drop that could only say
 * "into" is half a feature: reordering siblings is most of what anyone does
 * with a file list, and a library that makes you drop into a parent and then
 * fix the order some other way has moved the work rather than done it.
 *
 *  - `into`   — become a child of the target.
 *  - `before` — become a sibling of the target, immediately ahead of it.
 *  - `after`  — become a sibling of the target, immediately behind it.
 */
export type DropMode = 'into' | 'before' | 'after'

export interface DropTarget {
  /** The node the pointer is over, as a PRUNED index — the same space
   * `hitTest` answers in and the renderer draws in. */
  index: number
  mode: DropMode
}

/**
 * Fraction of a node taken by each of its two edge bands.
 *
 * The middle half means "into", and the outer quarters mean "beside". A
 * three-way split of a 30px row gives 7px targets at the edges, which is
 * comfortably above the ~5px anyone can hit reliably and still leaves the
 * common case — dropping into a folder — the biggest share of the node.
 *
 * Deliberately a FRACTION, not a pixel count: a row and a card differ by an
 * order of magnitude in size, and a fixed 8px band that reads as a thin edge on
 * a 96px card is most of a 24px row.
 */
const EDGE_BAND = 0.25

/**
 * Which axis siblings are laid out along, for a given layout and orientation —
 * i.e. which way the pointer has to move to mean "before" rather than "into".
 *
 * `null` for the layouts where the question has no answer. On a wheel there is
 * no reading order a viewer could point at: sibling segments are arranged by
 * angle, and "the segment 3° anticlockwise" is not a position anyone is trying
 * to express with a pointer. Those layouts get `into` and nothing else, which
 * is the honest reduction rather than a guess.
 */
function siblingAxis(layout: LayoutName, horizontal: boolean): 'x' | 'y' | null {
  switch (layout) {
    case 'file':
      // A list. Siblings stack downward, always — `file` ignores orientation.
      return 'y'
    case 'tidy':
      // Siblings sit side by side ACROSS the growth axis: left-to-right on a
      // top-down chart, top-to-bottom on a left-right one.
      return horizontal ? 'y' : 'x'
    default:
      return null
  }
}

/**
 * Resolves a pointer position over node `index` into what dropping there would
 * mean.
 *
 * Pure, and deliberately separate from hit-testing: `hitTest` answers "which
 * node", which the engine and the worker host each already do their own way
 * (box quadtree, or `hitTestSector` on a wheel). This answers "and where in
 * it", which is the same question for both and depends only on the layout and
 * the box.
 *
 * `box` is the target's own `[x, y, w, h]` in world units — the caller has it
 * to hand from the same array it hit-tested against, and passing it beats
 * passing the whole layout for one lookup.
 */
export function resolveDropMode(
  layout: LayoutName,
  horizontal: boolean,
  box: { x: number; y: number; w: number; h: number },
  worldX: number,
  worldY: number,
): DropMode {
  const axis = siblingAxis(layout, horizontal)
  if (axis === null) return 'into'

  const start = axis === 'x' ? box.x : box.y
  const extent = axis === 'x' ? box.w : box.h
  // A zero-extent node has no bands to divide; treat the whole of it as
  // "into" rather than dividing by zero into a NaN comparison that reads as
  // `after` by accident.
  if (extent <= 0) return 'into'

  const t = ((axis === 'x' ? worldX : worldY) - start) / extent
  if (t < EDGE_BAND) return 'before'
  if (t > 1 - EDGE_BAND) return 'after'
  return 'into'
}

/**
 * Whether a drop onto `target` is structurally possible.
 *
 * One rule, and it is the one that must hold whatever the mode: the target may
 * not be a node the drag is carrying, nor inside one. A node cannot become its
 * own descendant — the result is a cycle detached from the root, which is not
 * a tree at all.
 *
 * Deliberately NOT a no-op check. "Dropping here would change nothing" — after
 * the sibling it already follows, into the parent it is already under — is a
 * judgement about the caller's own data and ordering, and a library that
 * guessed at it would refuse drops that were meaningful (reordering within a
 * parent that renders its children sorted, say) to prevent ones that were
 * merely pointless. A pointless drop is harmless; a refused one is a bug
 * report.
 *
 * `moving` is a MASK over pruned indices, built once at drag start (see
 * `subtreeMask`). The alternative — walking the target's ancestor chain per
 * pointer move — is O(depth) on every event, and a drag produces them as fast
 * as the pointer can move across a tree that may be tens of thousands deep.
 */
export function isDropAllowed(moving: Uint8Array, target: number): boolean {
  if (target < 0 || target >= moving.length) return false
  return moving[target] !== 1
}

/**
 * A mask over PRUNED indices marking every node in the subtrees rooted at
 * `roots` — the nodes a drag is carrying.
 *
 * Built once when the drag starts, then read as a single array lookup per
 * pointer move. That is the whole reason it exists: the obvious
 * implementation of "would this be a cycle" walks the target's ancestor chain
 * on every move, which is O(depth) per event on a tree whose depth is not
 * bounded, and a drag generates events as fast as the pointer can produce
 * them.
 *
 * Iterative, never recursive — a 50k-deep chain is a supported input.
 */
export function subtreeMask(tree: Tree, roots: readonly number[]): Uint8Array {
  const mask = new Uint8Array(tree.count)
  const stack: number[] = []
  for (const root of roots) {
    if (root >= 0 && root < tree.count) stack.push(root)
  }
  while (stack.length > 0) {
    const node = stack.pop()!
    if (mask[node] === 1) continue // a second root inside a first one's subtree
    mask[node] = 1
    for (let c = tree.childStart[node]!; c < tree.childStart[node + 1]!; c++) {
      stack.push(tree.childIndex[c]!)
    }
  }
  return mask
}

/**
 * Where `mode` relative to `target` actually puts a node: the parent it lands
 * under, and its position among that parent's children.
 *
 * Returned in PRUNED indices; a host translates to its own ids. `parent` is
 * `-1` for a drop that would make the node a root, which `before`/`after` a
 * root does.
 *
 * The index is the slot the node takes among the target's siblings BEFORE any
 * of the moving nodes are removed. A caller applying the move to its own array
 * has to account for that when the node is moving within the same parent —
 * which is why this reports a position rather than performing the move: only
 * the caller knows the shape of its own data.
 */
export function dropPosition(
  tree: Tree,
  target: number,
  mode: DropMode,
): { parent: number; index: number } {
  if (mode === 'into') {
    return { parent: target, index: tree.childStart[target + 1]! - tree.childStart[target]! }
  }
  const parent = tree.parent[target]!
  if (parent === -1) {
    // A sibling of a root is another root. Its position is among `tree.roots`,
    // which is the one child list the tree does not store under a parent.
    const at = tree.roots.indexOf(target)
    return { parent: -1, index: mode === 'before' ? at : at + 1 }
  }
  const from = tree.childStart[parent]!
  let at = 0
  for (let c = from; c < tree.childStart[parent + 1]!; c++, at++) {
    if (tree.childIndex[c] === target) break
  }
  return { parent, index: mode === 'before' ? at : at + 1 }
}
