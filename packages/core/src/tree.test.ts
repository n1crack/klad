import { describe, expect, it } from 'vitest'
import { normalize, subtreeOf, wouldCreateCycle } from './tree.js'

describe('normalize', () => {
  it('indexes a simple tree and builds CSR children', () => {
    const t = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'a' },
      { id: 'd', parentId: 'b' },
    ])

    expect(t.count).toBe(4)
    expect(t.indexToId).toEqual(['a', 'b', 'c', 'd'])
    expect(t.idToIndex.get('c')).toBe(2)
    expect(Array.from(t.roots)).toEqual([0])
    expect(Array.from(t.parent)).toEqual([-1, 0, 0, 1])
    expect(Array.from(t.depth)).toEqual([0, 1, 1, 2])
    expect(t.warnings).toEqual([])
  })

  it('preserves input order among siblings', () => {
    const t = normalize([
      { id: 'root' },
      { id: 'z', parentId: 'root' },
      { id: 'a', parentId: 'root' },
    ])
    const start = t.childStart[0]!
    const end = t.childStart[1]!
    const names = Array.from(t.childIndex.slice(start, end)).map((i) => t.indexToId[i])
    expect(names).toEqual(['z', 'a'])
  })

  it('emits preorder with parents before children', () => {
    const t = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'a' },
    ])
    const pos = new Map(Array.from(t.order).map((idx, i) => [t.indexToId[idx]!, i]))
    expect(pos.get('a')!).toBeLessThan(pos.get('b')!)
    expect(pos.get('b')!).toBeLessThan(pos.get('c')!)
    expect(pos.get('a')!).toBeLessThan(pos.get('d')!)
    expect(t.order.length).toBe(4)
  })

  it('treats an unresolvable parentId as a root and warns', () => {
    const t = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'ghost' },
    ])
    expect(Array.from(t.roots)).toEqual([0, 1])
    expect(t.warnings).toEqual([
      { code: 'orphan-parent', detail: 'parent "ghost" not found', ids: ['b'] },
    ])
  })

  it('keeps the last node when ids are duplicated and warns', () => {
    const t = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'a', tag: 'first' },
      { id: 'b', parentId: 'a', tag: 'second' },
    ])
    expect(t.count).toBe(2)
    expect(t.warnings[0]!.code).toBe('duplicate-id')
    expect(t.warnings[0]!.ids).toEqual(['b'])
  })

  it('breaks a cycle by rooting the back-edge node and warns with the path', () => {
    const t = normalize([
      { id: 'a', parentId: 'c' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ])
    expect(t.warnings[0]!.code).toBe('cycle')
    // The path follows parent links from the entry point: a -> c -> b.
    expect(t.warnings[0]!.ids).toEqual(['a', 'c', 'b'])
    expect(t.warnings[0]!.detail).toBe('cycle detected: a -> c -> b')
    expect(Array.from(t.roots)).toEqual([0])
    expect(t.parent[0]).toBe(-1)
    expect(t.count).toBe(3)
  })

  it('breaks a self-parent cycle and roots the node', () => {
    const t = normalize([{ id: 'a', parentId: 'a' }])
    expect(t.warnings).toEqual([
      { code: 'cycle', detail: 'cycle detected: a', ids: ['a'] },
    ])
    expect(Array.from(t.roots)).toEqual([0])
    expect(t.parent[0]).toBe(-1)
  })

  it('breaks two disjoint cycles independently, with two separate warnings', () => {
    const t = normalize([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'd' },
      { id: 'd', parentId: 'c' },
    ])
    const cycleWarnings = t.warnings.filter((w) => w.code === 'cycle')
    expect(cycleWarnings).toHaveLength(2)
    expect(cycleWarnings[0]!.ids).toEqual(['a', 'b'])
    expect(cycleWarnings[1]!.ids).toEqual(['c', 'd'])
    // Both back-edge nodes are rooted; each cycle is broken on its own.
    expect(t.parent[t.idToIndex.get('a')!]).toBe(-1)
    expect(t.parent[t.idToIndex.get('c')!]).toBe(-1)
    expect(Array.from(t.roots)).toEqual(
      expect.arrayContaining([t.idToIndex.get('a')!, t.idToIndex.get('c')!]),
    )
  })

  it('reports only the cycle members when a non-cyclic chain leads into a cycle', () => {
    // x -> a -> b -> a: x is not part of the cycle, only a and b are.
    const t = normalize([
      { id: 'x', parentId: 'a' },
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ])
    const cycleWarnings = t.warnings.filter((w) => w.code === 'cycle')
    expect(cycleWarnings).toHaveLength(1)
    expect(cycleWarnings[0]!.ids).toEqual(['a', 'b'])
    // x still points at a; a is the one rooted to break the cycle.
    expect(t.parent[t.idToIndex.get('x')!]).toBe(t.idToIndex.get('a')!)
    expect(t.parent[t.idToIndex.get('a')!]).toBe(-1)
  })

  it('handles empty input', () => {
    const t = normalize([])
    expect(t.count).toBe(0)
    expect(Array.from(t.roots)).toEqual([])
    expect(t.order.length).toBe(0)
  })

  it('handles a 50k-node chain without overflowing the stack', () => {
    const data = Array.from({ length: 50_000 }, (_, i) => ({
      id: `n${i}`,
      ...(i === 0 ? {} : { parentId: `n${i - 1}` }),
    }))
    const t = normalize(data)
    expect(t.count).toBe(50_000)
    expect(t.depth[49_999]).toBe(49_999)
  })
})

describe('subtreeOf', () => {
  it('returns the node and all its descendants in preorder', () => {
    const t = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'a' },
    ])
    const ids = Array.from(subtreeOf(t, t.idToIndex.get('b')!)).map((i) => t.indexToId[i])
    expect(ids).toEqual(['b', 'c'])
  })

  it('returns the whole tree in preorder when called on a root', () => {
    const t = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'a' },
    ])
    const ids = Array.from(subtreeOf(t, t.idToIndex.get('a')!)).map((i) => t.indexToId[i])
    expect(ids).toEqual(Array.from(t.order).map((i) => t.indexToId[i]))
  })

  it('returns an empty array for an out-of-range index', () => {
    const t = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    expect(Array.from(subtreeOf(t, 99))).toEqual([])
    expect(Array.from(subtreeOf(t, -5))).toEqual([])
  })
})

describe('wouldCreateCycle', () => {
  it('rejects reparenting a node under its own descendant', () => {
    const t = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ])
    expect(wouldCreateCycle(t, t.idToIndex.get('a')!, t.idToIndex.get('c')!)).toBe(true)
  })

  it('rejects reparenting a node under itself', () => {
    const t = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    const b = t.idToIndex.get('b')!
    expect(wouldCreateCycle(t, b, b)).toBe(true)
  })

  it('allows a valid reparent', () => {
    const t = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'a' },
    ])
    expect(wouldCreateCycle(t, t.idToIndex.get('c')!, t.idToIndex.get('b')!)).toBe(false)
  })

  it('returns false (and returns at all) for an out-of-range index, without hanging', () => {
    const t = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    const b = t.idToIndex.get('b')!
    expect(wouldCreateCycle(t, 99, b)).toBe(false)
    expect(wouldCreateCycle(t, -5, b)).toBe(false)
  })

  it('returns false (and returns at all) for an out-of-range newParent, without hanging', () => {
    const t = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    const b = t.idToIndex.get('b')!
    expect(wouldCreateCycle(t, b, 99)).toBe(false)
    expect(wouldCreateCycle(t, b, -5)).toBe(false)
  })
})
