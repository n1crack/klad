import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { radial } from './radial.js'
import type { NodeData } from '../types.js'

const TAU = Math.PI * 2

const DATA: NodeData[] = [
  { id: 'root' },
  { id: 'a', parentId: 'root' },
  { id: 'a1', parentId: 'a' },
  { id: 'a2', parentId: 'a' },
  { id: 'b', parentId: 'root' },
  { id: 'b1', parentId: 'b' },
]

function build(w = 20, h = 20) {
  const tree = normalize(DATA)
  const sizes = new Float64Array(tree.count * 2)
  for (let i = 0; i < tree.count; i++) {
    sizes[i * 2] = w
    sizes[i * 2 + 1] = h
  }
  return { tree, sizes }
}

const OPTS = { spacingX: 16, spacingY: 48, step: 100 }

/** Distance from the wheel's centre to node `i`'s own centre. */
function radiusOf(boxes: Float64Array, i: number, centre: number): number {
  const cx = boxes[i * 4]! + boxes[i * 4 + 2]! / 2
  const cy = boxes[i * 4 + 1]! + boxes[i * 4 + 3]! / 2
  return Math.hypot(cx - centre, cy - centre)
}

describe('radial layout', () => {
  it('centres the root and puts each generation on its own ring', () => {
    const { tree, sizes } = build()
    const { boxes, bounds } = radial(tree, sizes, OPTS)
    const centre = bounds.maxX / 2
    const at = (id: string) => radiusOf(boxes, tree.idToIndex.get(id)!, centre)

    expect(at('root')).toBeCloseTo(0)
    expect(at('a')).toBeCloseTo(100)
    expect(at('b')).toBeCloseTo(100)
    expect(at('a1')).toBeCloseTo(200)
  })

  it('frames a square with the root at its exact centre', () => {
    const { tree, sizes } = build()
    const { bounds } = radial(tree, sizes, OPTS)
    // Not the tight bbox of the cards: a wheel is read from the middle, so the
    // root belongs at the middle of the frame however lopsided the tree is.
    expect(bounds.maxX).toBe(bounds.maxY)
    expect(bounds.minX).toBe(0)
    expect(bounds.minY).toBe(0)
  })

  it('gives a bushier subtree proportionally more of the circle', () => {
    const { tree, sizes } = build()
    const { angles } = radial(tree, sizes, OPTS)
    // The wedges themselves are internal, so assert the observable
    // consequence instead: `a`'s two children straddle `a`'s own angle (it
    // owns a wedge wide enough to fan them either side of it), while `b`'s
    // single child sits exactly on `b`'s.
    const at = (id: string) => angles![tree.idToIndex.get(id)!]!
    expect(at('b1')).toBeCloseTo(at('b'))
    expect(Math.min(at('a1'), at('a2'))).toBeLessThan(at('a'))
    expect(Math.max(at('a1'), at('a2'))).toBeGreaterThan(at('a'))
  })

  it('starts the partition at twelve o’clock', () => {
    // Four equal-weight branches, so each owns exactly a quarter turn and the
    // first one's CENTRE lands half a quarter past the start — which pins down
    // where the partition begins without the layout having to expose its
    // internal wedges. Reading a wheel starts at the top; a chart that opened
    // at 3 o'clock would be correct and still feel wrong.
    const tree = normalize([
      { id: 'root' },
      { id: 'q1', parentId: 'root' },
      { id: 'q2', parentId: 'root' },
      { id: 'q3', parentId: 'root' },
      { id: 'q4', parentId: 'root' },
    ])
    const sizes = new Float64Array(tree.count * 2).fill(20)
    const { angles } = radial(tree, sizes, OPTS)
    expect(angles![tree.idToIndex.get('q1')!]!).toBeCloseTo(-Math.PI / 2 + TAU / 8)
    expect(angles![tree.idToIndex.get('q2')!]!).toBeCloseTo(-Math.PI / 2 + (3 * TAU) / 8)
  })

  it('marks the centre node as having no label direction', () => {
    const { tree, sizes } = build()
    const { angles } = radial(tree, sizes, OPTS)
    // NaN, not 0: a node sitting ON the centre has no outward ray, and the
    // alternative — leaving its wedge's mid-angle in place — rotates the one
    // label a viewer reads first by half a turn's worth of nothing.
    expect(Number.isNaN(angles![tree.idToIndex.get('root')!]!)).toBe(true)
    for (const id of ['a', 'b', 'a1']) {
      expect(Number.isFinite(angles![tree.idToIndex.get(id)!]!)).toBe(true)
    }
  })

  it('reserves label room outside the last ring even when the nodes are dots', () => {
    const { tree, sizes } = build(6, 6)
    const result = radial(tree, sizes, OPTS)
    // The natural way to use this layout is a marker plus a radiating name, so
    // the reserve must NOT be the node's own width — that would be a dot's
    // width, and `fit()` would frame the wheel with no room for any text.
    expect(result.labelSpace).toBeGreaterThan(6)
    expect(result.labelSpace).toBeCloseTo(75) // 0.75 of one ring
    expect(result.bounds.maxX).toBeCloseTo(2 * (2 * 100 + 75))
  })

  it('uses the widest node when that is larger than the ring-derived reserve', () => {
    const { tree, sizes } = build(400, 20)
    expect(radial(tree, sizes, OPTS).labelSpace).toBe(400)
  })

  it('handles an empty tree', () => {
    const tree = normalize([])
    const { boxes, bounds } = radial(tree, new Float64Array(0), OPTS)
    expect(boxes.length).toBe(0)
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })
})
