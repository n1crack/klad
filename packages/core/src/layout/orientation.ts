import type { Bounds } from '../types.js'

export type Orientation = 'tb' | 'bt' | 'lr' | 'rl'

/**
 * Rewrites a canonical top-down layout into the requested orientation.
 * Mutates `boxes` in place — it is a transferable buffer and copying it per
 * relayout would be pure waste at 50k nodes.
 *
 * Order of operations: transpose (for horizontal orientations), then two
 * independent flips:
 *  - a **main-axis** flip that reverses depth direction, gated solely on the
 *    orientation: 'bt' flips y, 'rl' flips x (after the transpose, so this is
 *    still "the axis the tree grows along" in both cases);
 *  - a **cross-axis** flip that reverses sibling order, gated solely on
 *    `rtl`: it flips x for 'tb'/'bt' and y for 'lr'/'rl' (again post-transpose).
 *
 * The two flips never share an axis for a given orientation, so neither can
 * cancel the other out — `applyOrientation(boxes, bounds, 'lr', true)` is
 * NOT the same layout as `applyOrientation(boxes, bounds, 'rl', false)`.
 * `lr + rtl` keeps the tree growing left-to-right and reverses sibling
 * (top-to-bottom -> bottom-to-top) order; `rl` alone keeps sibling order and
 * reverses growth direction.
 *
 * Preconditions (unchecked except where noted — the caller, `layout()`, is
 * trusted to uphold them):
 *  - `boxes` must be **fresh `layout()` output**, never the output of a
 *    previous `applyOrientation` call. Applying this transform twice is not
 *    idempotent (e.g. 'lr' applied twice returns to the canonical 'tb'
 *    layout) — always re-run from the canonical layout when re-orienting.
 *  - `bounds.minX` and `bounds.minY` must be 0, as `layout()` guarantees.
 *    The mirror math below only reads `maxX`/`maxY` and hardcodes the
 *    returned origin at 0; a non-zero `minX`/`minY` would mirror around the
 *    wrong point and silently produce spatially wrong (but still in-bounds)
 *    output. Asserted cheaply below since it's an O(1) check.
 */
export function applyOrientation(
  boxes: Float64Array,
  bounds: Bounds,
  orientation: Orientation,
  rtl: boolean,
): Bounds {
  if (bounds.minX !== 0 || bounds.minY !== 0) {
    throw new Error('applyOrientation requires bounds.minX === 0 && bounds.minY === 0 (as layout() guarantees)')
  }

  const n = boxes.length / 4
  let { maxX, maxY } = bounds

  const horizontal = orientation === 'lr' || orientation === 'rl'
  if (horizontal) {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      const x = boxes[o]!
      const y = boxes[o + 1]!
      const w = boxes[o + 2]!
      const h = boxes[o + 3]!
      boxes[o] = y
      boxes[o + 1] = x
      boxes[o + 2] = h
      boxes[o + 3] = w
    }
    const swap = maxX
    maxX = maxY
    maxY = swap
  }

  // Main-axis flip: reverses depth direction. Gated solely on orientation —
  // independent of rtl. 'bt' flips y (vertical orientations); 'rl' flips x
  // after the transpose above (horizontal orientations).
  if (orientation === 'bt') {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      boxes[o + 1] = maxY - (boxes[o + 1]! + boxes[o + 3]!)
    }
  } else if (orientation === 'rl') {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      boxes[o] = maxX - (boxes[o]! + boxes[o + 2]!)
    }
  }

  // Cross-axis flip: reverses sibling order. Gated solely on rtl —
  // independent of the main-axis flip above. Cross axis is x for tb/bt,
  // y for lr/rl (post-transpose).
  if (rtl) {
    if (horizontal) {
      for (let i = 0; i < n; i++) {
        const o = i * 4
        boxes[o + 1] = maxY - (boxes[o + 1]! + boxes[o + 3]!)
      }
    } else {
      for (let i = 0; i < n; i++) {
        const o = i * 4
        boxes[o] = maxX - (boxes[o]! + boxes[o + 2]!)
      }
    }
  }

  return { minX: 0, minY: 0, maxX, maxY }
}
