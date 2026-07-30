import type { Tree } from '../tree.js'
import type { LayoutOptions, LayoutResult } from './types.js'

/**
 * Indent per depth level when `opts.step` is omitted: a fraction of the
 * TALLEST row, so the indent tracks how big the rows actually are without
 * needing to know their widths (which, in a file list, are usually uniform and
 * say nothing about the nesting). A shade under half a row height reads as a
 * clear step without pushing a deep tree off the right-hand side. Floored at 1
 * so an all-zero-size input can't collapse every level onto x = 0.
 */
function deriveIndent(sizes: Float64Array, n: number): number {
  let max = 0
  for (let i = 0; i < n; i++) {
    const h = sizes[i * 2 + 1]!
    if (h > max) max = h
  }
  const indent = max * 0.45
  return indent > 1 ? indent : 1
}

/**
 * File-explorer layout: one row per node, in tree order, each indented by its
 * depth.
 *
 * This is the one layout whose width does not explode as the tree grows — a
 * thousand siblings cost a thousand rows, not a thousand columns — which is
 * exactly why a file explorer has looked like this since before there were
 * windows to put one in. Height grows linearly with the visible node count and
 * the viewport scrolls through it.
 *
 * `opts.step` sets the per-level indent (derived from the row heights when
 * omitted) and `opts.rowGap` the gap between consecutive rows (defaults to
 * `spacingY`). Each node keeps its own declared `[w, h]`, so a host is free to
 * give a folder row a different height from a file row, or to make every row
 * the same full width — the layout has no opinion, it only stacks them.
 *
 * Canonical output (origin at 0,0); RTL mirroring is applied afterwards by the
 * engine. Never recurses — one flat pass over `order`, which is already
 * preorder, so a parent is always placed before its children and the rows come
 * out in exactly the order a viewer reads them.
 */
export function file(tree: Tree, sizes: Float64Array, opts: LayoutOptions): LayoutResult {
  const n = tree.count
  const boxes = new Float64Array(n * 4)
  if (n === 0) {
    return { boxes, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  }

  const { order, depth } = tree
  const indent = opts.step ?? deriveIndent(sizes, n)
  const gap = opts.rowGap ?? opts.spacingY

  let cursorY = 0
  let maxX = 0
  for (let k = 0; k < n; k++) {
    const i = order[k]!
    const w = sizes[i * 2]!
    const h = sizes[i * 2 + 1]!
    const x = depth[i]! * indent
    const o = i * 4
    boxes[o] = x
    boxes[o + 1] = cursorY
    boxes[o + 2] = w
    boxes[o + 3] = h
    if (x + w > maxX) maxX = x + w
    cursorY += h + gap
  }

  // The trailing gap after the last row is not part of the content — including
  // it would make `fit()` leave a band of dead space at the bottom that grows
  // with `rowGap`.
  const maxY = cursorY > 0 ? cursorY - gap : 0

  return { boxes, bounds: { minX: 0, minY: 0, maxX, maxY } }
}
