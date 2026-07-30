import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { dropPosition, isDropAllowed, resolveDropMode, subtreeMask } from './drop-target.js'
import type { NodeData } from '../types.js'

const DATA: NodeData[] = [
  { id: 'root' },
  { id: 'a', parentId: 'root' },
  { id: 'a1', parentId: 'a' },
  { id: 'a2', parentId: 'a' },
  { id: 'b', parentId: 'root' },
  { id: 'b1', parentId: 'b' },
]

const tree = normalize(DATA)
const at = (id: string): number => tree.idToIndex.get(id)!

/** A 100x40 row at the origin. */
const ROW = { x: 0, y: 0, w: 100, h: 40 }

describe('resolveDropMode', () => {
  it('splits a file row into before / into / after down its height', () => {
    // A list stacks downward, so the gesture that means "put it between these
    // two" is a vertical one.
    expect(resolveDropMode('file', false, ROW, 50, 2)).toBe('before')
    expect(resolveDropMode('file', false, ROW, 50, 20)).toBe('into')
    expect(resolveDropMode('file', false, ROW, 50, 38)).toBe('after')
  })

  it('ignores orientation for a file list', () => {
    // `file` is a vertical list of rows whatever `orientation` says — see the
    // engine. The drop bands have to agree, or a chart under `lr` would offer
    // "before" along an axis its rows do not run on.
    expect(resolveDropMode('file', true, ROW, 50, 2)).toBe('before')
    expect(resolveDropMode('file', true, ROW, 2, 20)).toBe('into')
  })

  it('splits a tidy node across the axis its SIBLINGS run along', () => {
    // Top-down: siblings sit left to right, so "before" is to the left.
    expect(resolveDropMode('tidy', false, ROW, 2, 20)).toBe('before')
    expect(resolveDropMode('tidy', false, ROW, 50, 20)).toBe('into')
    expect(resolveDropMode('tidy', false, ROW, 98, 20)).toBe('after')

    // Left-right: the tree grows along x, so siblings stack along y instead.
    expect(resolveDropMode('tidy', true, ROW, 50, 2)).toBe('before')
    expect(resolveDropMode('tidy', true, ROW, 50, 20)).toBe('into')
    expect(resolveDropMode('tidy', true, ROW, 50, 38)).toBe('after')
  })

  it('offers only "into" on a wheel', () => {
    // Sibling segments are arranged by ANGLE, and "the segment three degrees
    // anticlockwise" is not a position anyone is trying to express with a
    // pointer. Reducing to `into` is the honest answer, not a guess.
    for (const layout of ['radial', 'sunburst'] as const) {
      for (const [x, y] of [[2, 2], [50, 20], [98, 38]] as const) {
        expect(resolveDropMode(layout, false, ROW, x, y)).toBe('into')
      }
    }
  })

  it('gives "into" the largest share of the node', () => {
    // The common case — drop onto a parent — should be the easiest to hit.
    let into = 0
    for (let y = 0; y < 40; y++) {
      if (resolveDropMode('file', false, ROW, 50, y + 0.5) === 'into') into++
    }
    expect(into).toBe(20)
  })

  it('does not divide by zero on a zero-extent node', () => {
    const collapsed = { x: 0, y: 0, w: 0, h: 0 }
    expect(resolveDropMode('file', false, collapsed, 0, 0)).toBe('into')
    expect(resolveDropMode('tidy', false, collapsed, 0, 0)).toBe('into')
  })
})

describe('subtreeMask', () => {
  it('marks the dragged node and everything under it', () => {
    const mask = subtreeMask(tree, [at('a')])
    expect(mask[at('a')]).toBe(1)
    expect(mask[at('a1')]).toBe(1)
    expect(mask[at('a2')]).toBe(1)
    expect(mask[at('root')]).toBe(0)
    expect(mask[at('b')]).toBe(0)
  })

  it('handles a multi-node drag, including nested roots', () => {
    // Dragging a node AND one of its own descendants is a selection a viewer
    // can easily make; marking the overlap twice must not loop.
    const mask = subtreeMask(tree, [at('a'), at('a1'), at('b')])
    expect(Array.from(mask)).toEqual(
      Array.from({ length: tree.count }, (_, i) => (i === at('root') ? 0 : 1)),
    )
  })

  it('ignores out-of-range roots rather than throwing', () => {
    expect(Array.from(subtreeMask(tree, [-1, 999]))).toEqual(Array.from({ length: tree.count }, () => 0))
  })

  it('never recurses', () => {
    // A deep chain is a supported input; a recursive walk would blow the stack
    // somewhere in the low tens of thousands.
    const deep: NodeData[] = [{ id: 'n0' }]
    for (let i = 1; i < 50_000; i++) deep.push({ id: `n${i}`, parentId: `n${i - 1}` })
    const chain = normalize(deep)
    const mask = subtreeMask(chain, [0])
    expect(mask.every((v) => v === 1)).toBe(true)
  })
})

describe('isDropAllowed', () => {
  it('refuses a drop into the moving subtree', () => {
    const moving = subtreeMask(tree, [at('a')])
    // A node cannot become its own descendant — the result is a cycle
    // detached from the root, which is not a tree.
    expect(isDropAllowed(moving, at('a'))).toBe(false)
    expect(isDropAllowed(moving, at('a1'))).toBe(false)
    expect(isDropAllowed(moving, at('b'))).toBe(true)
    expect(isDropAllowed(moving, at('root'))).toBe(true)
  })

  it('refuses an out-of-range target', () => {
    const moving = subtreeMask(tree, [at('a')])
    expect(isDropAllowed(moving, -1)).toBe(false)
    expect(isDropAllowed(moving, 999)).toBe(false)
  })
})

describe('dropPosition', () => {
  it('appends for an "into" drop', () => {
    expect(dropPosition(tree, at('b'), 'into')).toEqual({ parent: at('b'), index: 1 })
    expect(dropPosition(tree, at('a1'), 'into')).toEqual({ parent: at('a1'), index: 0 })
  })

  it('reports the slot beside a sibling', () => {
    expect(dropPosition(tree, at('a1'), 'before')).toEqual({ parent: at('a'), index: 0 })
    expect(dropPosition(tree, at('a1'), 'after')).toEqual({ parent: at('a'), index: 1 })
    expect(dropPosition(tree, at('a2'), 'before')).toEqual({ parent: at('a'), index: 1 })
    expect(dropPosition(tree, at('a2'), 'after')).toEqual({ parent: at('a'), index: 2 })
  })

  it('makes a new root beside a root', () => {
    // A sibling of a root is another root, and its position is among
    // `tree.roots` — the one child list not stored under a parent.
    const forest = normalize([{ id: 'r1' }, { id: 'r2' }, { id: 'c', parentId: 'r1' }])
    const r2 = forest.idToIndex.get('r2')!
    expect(dropPosition(forest, r2, 'before')).toEqual({ parent: -1, index: 1 })
    expect(dropPosition(forest, r2, 'after')).toEqual({ parent: -1, index: 2 })
  })
})
