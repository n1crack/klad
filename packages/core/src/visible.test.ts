import { describe, expect, it } from 'vitest'
import { normalize } from './tree.js'
import { pruneToVisible } from './visible.js'

const DATA = [
  { id: 'a' },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: 'a' },
]

/** open flags with every node expanded. */
function allOpen(count: number): Uint8Array {
  return new Uint8Array(count).fill(1)
}

describe('pruneToVisible', () => {
  it('keeps the whole tree when everything is open', () => {
    const tree = normalize(DATA)
    const v = pruneToVisible(tree, allOpen(tree.count))
    expect(v.tree.count).toBe(4)
    expect(v.tree.indexToId).toEqual(['a', 'b', 'c', 'd'])
    expect(Array.from(v.toSource)).toEqual([0, 1, 2, 3])
    expect(Array.from(v.fromSource)).toEqual([0, 1, 2, 3])
  })

  it('drops descendants of a closed node but keeps the node itself', () => {
    const tree = normalize(DATA)
    const open = allOpen(tree.count)
    open[tree.idToIndex.get('b')!] = 0

    const v = pruneToVisible(tree, open)
    expect(v.tree.indexToId).toEqual(['a', 'b', 'd'])
    expect(v.fromSource[tree.idToIndex.get('c')!]).toBe(-1)
    // 'b' is still present and now has no children.
    const b = v.tree.idToIndex.get('b')!
    expect(v.tree.childStart[b + 1]! - v.tree.childStart[b]!).toBe(0)
  })

  it('drops a whole branch when the root is closed', () => {
    const tree = normalize(DATA)
    const open = new Uint8Array(tree.count) // all closed
    const v = pruneToVisible(tree, open)
    expect(v.tree.indexToId).toEqual(['a'])
    expect(Array.from(v.tree.roots)).toEqual([0])
  })

  it('produces a tree whose parent and CSR arrays are internally consistent', () => {
    const tree = normalize(DATA)
    const open = allOpen(tree.count)
    open[tree.idToIndex.get('b')!] = 0
    const v = pruneToVisible(tree, open)

    for (let i = 0; i < v.tree.count; i++) {
      const from = v.tree.childStart[i]!
      const to = v.tree.childStart[i + 1]!
      for (let c = from; c < to; c++) {
        expect(v.tree.parent[v.tree.childIndex[c]!]).toBe(i)
      }
    }
    expect(v.tree.order.length).toBe(v.tree.count)
    expect(v.tree.childStart[v.tree.count]).toBe(v.tree.count - v.tree.roots.length)
  })

  it('keeps a forest of roots visible even when all are closed', () => {
    const tree = normalize([{ id: 'a' }, { id: 'b' }, { id: 'c', parentId: 'b' }])
    const v = pruneToVisible(tree, new Uint8Array(tree.count))
    expect(v.tree.indexToId).toEqual(['a', 'b'])
    expect(Array.from(v.tree.roots)).toEqual([0, 1])
  })

  it('handles an empty tree', () => {
    const tree = normalize([])
    const v = pruneToVisible(tree, new Uint8Array(0))
    expect(v.tree.count).toBe(0)
    expect(v.toSource.length).toBe(0)
  })

  it('does not recurse on a 50k-deep open chain', () => {
    const data = Array.from({ length: 50_000 }, (_, i) => ({
      id: `n${i}`,
      ...(i === 0 ? {} : { parentId: `n${i - 1}` }),
    }))
    const tree = normalize(data)
    const v = pruneToVisible(tree, allOpen(tree.count))
    expect(v.tree.count).toBe(50_000)
  })
})
