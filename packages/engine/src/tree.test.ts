import { describe, expect, it } from 'vitest'
import { normalize, subtreeOf, wouldCreateCycle, computeSubtreeStats } from './tree.js'
import type { NodeData } from './types.js'

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
    const t = normalize([{ id: 'root' }, { id: 'z', parentId: 'root' }, { id: 'a', parentId: 'root' }])
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
    const t = normalize([{ id: 'a' }, { id: 'b', parentId: 'ghost' }])
    expect(Array.from(t.roots)).toEqual([0, 1])
    expect(t.warnings).toEqual([{ code: 'orphan-parent', detail: 'parent "ghost" not found', ids: ['b'] }])
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
    expect(t.warnings).toEqual([{ code: 'cycle', detail: 'cycle detected: a', ids: ['a'] }])
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
    const t = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }])
    expect(wouldCreateCycle(t, t.idToIndex.get('a')!, t.idToIndex.get('c')!)).toBe(true)
  })

  it('rejects reparenting a node under itself', () => {
    const t = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    const b = t.idToIndex.get('b')!
    expect(wouldCreateCycle(t, b, b)).toBe(true)
  })

  it('allows a valid reparent', () => {
    const t = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'a' }])
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

describe('computeSubtreeStats', () => {
  // a
  // ├── b
  // │   ├── d
  // │   └── e
  // │       └── f
  // └── c
  const DATA = [
    { id: 'a' },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'a' },
    { id: 'd', parentId: 'b' },
    { id: 'e', parentId: 'b' },
    { id: 'f', parentId: 'e' },
  ]

  const statsOf = (data: { id: string; parentId?: string }[]) => {
    const tree = normalize(data)
    const stats = computeSubtreeStats(tree)
    return (id: string) => {
      const i = tree.idToIndex.get(id)!
      return {
        directChildren: stats.directChildren[i]!,
        descendants: stats.descendants[i]!,
        height: stats.height[i]!,
        depth: tree.depth[i]!,
      }
    }
  }

  it('counts direct children, total descendants, and subtree height', () => {
    const at = statsOf(DATA)

    expect(at('a')).toEqual({ directChildren: 2, descendants: 5, height: 3, depth: 0 })
    expect(at('b')).toEqual({ directChildren: 2, descendants: 3, height: 2, depth: 1 })
    // A leaf: nothing below it in any of the three senses.
    expect(at('c')).toEqual({ directChildren: 0, descendants: 0, height: 0, depth: 1 })
    expect(at('d')).toEqual({ directChildren: 0, descendants: 0, height: 0, depth: 2 })
    // One child, which is itself a leaf.
    expect(at('e')).toEqual({ directChildren: 1, descendants: 1, height: 1, depth: 2 })
    expect(at('f')).toEqual({ directChildren: 0, descendants: 0, height: 0, depth: 3 })
  })

  it('numbers the nested set so a subtree is one contiguous range', () => {
    const tree = normalize(DATA)
    const stats = computeSubtreeStats(tree)
    const at = (id: string) => {
      const i = tree.idToIndex.get(id)!
      return { lft: stats.lft[i]!, rgt: stats.rgt[i]! }
    }

    // a(1..12): b(2..9) contains d(3,4) and e(5..8) which contains f(6,7);
    // then c(10,11).
    expect(at('a')).toEqual({ lft: 1, rgt: 12 })
    expect(at('b')).toEqual({ lft: 2, rgt: 9 })
    expect(at('d')).toEqual({ lft: 3, rgt: 4 })
    expect(at('e')).toEqual({ lft: 5, rgt: 8 })
    expect(at('f')).toEqual({ lft: 6, rgt: 7 })
    expect(at('c')).toEqual({ lft: 10, rgt: 11 })

    // The property the numbering exists for: containment is a comparison, not
    // a walk up the parent chain.
    const inside = (child: string, ancestor: string): boolean =>
      at(child).lft > at(ancestor).lft && at(child).rgt < at(ancestor).rgt
    expect(inside('f', 'b')).toBe(true)
    expect(inside('f', 'a')).toBe(true)
    expect(inside('f', 'c')).toBe(false)
    expect(inside('c', 'b')).toBe(false)
    // Not its own ancestor — strict on both sides.
    expect(inside('b', 'b')).toBe(false)

    // And the pair carries the subtree size: rgt - lft === 2 * descendants + 1.
    for (let i = 0; i < tree.count; i++) {
      expect(stats.rgt[i]! - stats.lft[i]!).toBe(stats.descendants[i]! * 2 + 1)
    }
  })

  it('numbers across the whole forest, so two roots never overlap', () => {
    // Per-root numbering would give both roots lft 1, and every containment
    // comparison across them would answer wrongly.
    const tree = normalize([
      { id: 'r1' },
      { id: 'r1a', parentId: 'r1' },
      { id: 'r2' },
      { id: 'r2a', parentId: 'r2' },
    ])
    const stats = computeSubtreeStats(tree)
    const at = (id: string) => {
      const i = tree.idToIndex.get(id)!
      return { lft: stats.lft[i]!, rgt: stats.rgt[i]! }
    }
    expect(at('r1')).toEqual({ lft: 1, rgt: 4 })
    expect(at('r1a')).toEqual({ lft: 2, rgt: 3 })
    expect(at('r2')).toEqual({ lft: 5, rgt: 8 })
    expect(at('r2a')).toEqual({ lft: 6, rgt: 7 })
    expect(at('r2a').lft > at('r1').lft && at('r2a').rgt < at('r1').rgt).toBe(false)
  })

  it('numbers a deep chain without recursing', () => {
    // The numbering is usually described as an enter/exit recursion. A 50k
    // chain is a supported input, so this one is a flat sweep — and this is
    // the test that would blow the stack if it stopped being one.
    const data: NodeData[] = [{ id: 'n0' }]
    for (let i = 1; i < 50_000; i++) data.push({ id: `n${i}`, parentId: `n${i - 1}` })
    const tree = normalize(data)
    const stats = computeSubtreeStats(tree)
    const first = tree.idToIndex.get('n0')!
    const last = tree.idToIndex.get('n49999')!
    expect(stats.lft[first]).toBe(1)
    expect(stats.rgt[first]).toBe(100_000)
    expect(stats.lft[last]).toBe(50_000)
    expect(stats.rgt[last]).toBe(50_001)
  })

  it('keeps each root to its own subtree', () => {
    const at = statsOf([
      { id: 'r1' },
      { id: 'r1a', parentId: 'r1' },
      { id: 'r2' },
      { id: 'r2a', parentId: 'r2' },
      { id: 'r2b', parentId: 'r2a' },
    ])

    expect(at('r1').descendants).toBe(1)
    expect(at('r1').height).toBe(1)
    expect(at('r2').descendants).toBe(2)
    expect(at('r2').height).toBe(2)
  })

  it('handles an empty tree', () => {
    const stats = computeSubtreeStats(normalize([]))
    expect(stats.directChildren.length).toBe(0)
    expect(stats.descendants.length).toBe(0)
    expect(stats.height.length).toBe(0)
  })

  // The reverse-preorder accumulation exists so depth never costs stack: a
  // recursive post-order walk blows up on a chain this long, which is an
  // input the library states it supports.
  it('does not recurse — a 50k-deep chain is a supported input', () => {
    const chain = Array.from({ length: 50_000 }, (_, i) => ({
      id: `n${i}`,
      ...(i === 0 ? {} : { parentId: `n${i - 1}` }),
    }))
    const at = statsOf(chain)

    expect(at('n0')).toEqual({
      directChildren: 1,
      descendants: 49_999,
      height: 49_999,
      depth: 0,
    })
    expect(at('n49999').descendants).toBe(0)
  })
})
