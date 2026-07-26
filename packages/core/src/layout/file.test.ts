import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { file } from './file.js'
import type { NodeData } from '../types.js'

/** A folder tree three deep, with a leaf between two folders at the top level
 * so row ORDER (not just indentation) is actually exercised. */
const DATA: NodeData[] = [
  { id: 'root' },
  { id: 'src', parentId: 'root' },
  { id: 'src/a.ts', parentId: 'src' },
  { id: 'src/lib', parentId: 'src' },
  { id: 'src/lib/b.ts', parentId: 'src/lib' },
  { id: 'readme', parentId: 'root' },
]

function build(sizeW = 300, sizeH = 20) {
  const tree = normalize(DATA)
  const sizes = new Float64Array(tree.count * 2)
  for (let i = 0; i < tree.count; i++) {
    sizes[i * 2] = sizeW
    sizes[i * 2 + 1] = sizeH
  }
  return { tree, sizes }
}

const boxOf = (boxes: Float64Array, i: number) => ({
  x: boxes[i * 4]!,
  y: boxes[i * 4 + 1]!,
  w: boxes[i * 4 + 2]!,
  h: boxes[i * 4 + 3]!,
})

describe('file layout', () => {
  it('gives every node its own row, in reading order', () => {
    const { tree, sizes } = build()
    const { boxes } = file(tree, sizes, { spacingX: 16, spacingY: 4, step: 18 })

    // `order` is preorder, which is exactly the order a file explorer lists
    // rows in — so y must increase monotonically along it.
    const ys = Array.from(tree.order, (i) => boxOf(boxes, i).y)
    for (let k = 1; k < ys.length; k++) expect(ys[k]!).toBeGreaterThan(ys[k - 1]!)

    // Rows are `height + rowGap` apart, and nothing overlaps.
    for (let k = 1; k < ys.length; k++) expect(ys[k]! - ys[k - 1]!).toBeCloseTo(24)
  })

  it('indents by depth, not by position in the list', () => {
    const { tree, sizes } = build()
    const { boxes } = file(tree, sizes, { spacingX: 16, spacingY: 4, step: 18 })
    const xOf = (id: string) => boxOf(boxes, tree.idToIndex.get(id)!).x

    expect(xOf('root')).toBe(0)
    expect(xOf('src')).toBe(18)
    expect(xOf('readme')).toBe(18) // same depth as `src`, six rows below it
    expect(xOf('src/a.ts')).toBe(36)
    expect(xOf('src/lib')).toBe(36)
    expect(xOf('src/lib/b.ts')).toBe(54)
  })

  it('derives an indent from the row heights when none is given', () => {
    const { tree, sizes } = build(300, 40)
    const { boxes } = file(tree, sizes, { spacingX: 16, spacingY: 4 })
    // 45% of the tallest row — see `deriveIndent`. The point of the assertion
    // is that it scales with the ROWS rather than defaulting to a constant.
    expect(boxOf(boxes, tree.idToIndex.get('src')!).x).toBeCloseTo(18)
  })

  it('defaults the row gap to spacingY', () => {
    const { tree, sizes } = build()
    const withGap = file(tree, sizes, { spacingX: 16, spacingY: 9 })
    const explicit = file(tree, sizes, { spacingX: 16, spacingY: 999, rowGap: 9 })
    expect(Array.from(withGap.boxes)).toEqual(Array.from(explicit.boxes))
  })

  it('leaves no trailing gap below the last row', () => {
    const { tree, sizes } = build()
    const { bounds } = file(tree, sizes, { spacingX: 16, spacingY: 4, step: 18 })
    // Six rows of 20 with five 4px gaps between them — NOT six gaps. A
    // trailing one would make `fit()` frame a band of dead space that grows
    // with `rowGap`.
    expect(bounds.maxY).toBe(6 * 20 + 5 * 4)
    expect(bounds.minX).toBe(0)
    expect(bounds.minY).toBe(0)
    // Widest row is the deepest one: three indents plus its own width.
    expect(bounds.maxX).toBe(3 * 18 + 300)
  })

  it('handles an empty tree', () => {
    const tree = normalize([])
    const { boxes, bounds } = file(tree, new Float64Array(0), { spacingX: 16, spacingY: 4 })
    expect(boxes.length).toBe(0)
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })
})
