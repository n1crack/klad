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

// --- Reusable invariant checker + seeded random-forest fuzzing --------------
//
// The reviewer's property test already confirmed these hold over 400 random
// forests x 4 open/closed masks. This section adds that coverage to the repo
// itself: a checker asserting every structural invariant a pruned Tree must
// satisfy, exercised over inline-seeded random forests (deterministic, no new
// dependency) so a future failure reproduces exactly.

interface PrunedTreeShape {
  count: number
  parent: Int32Array
  childStart: Int32Array
  childIndex: Int32Array
  roots: Int32Array
  depth: Int32Array
  order: Int32Array
}

/** Asserts every structural invariant a pruned/normalized Tree must satisfy. */
function assertTreeInvariants(tree: PrunedTreeShape): void {
  const { count, parent, childStart, childIndex, roots, depth, order } = tree

  // childStart.length === count + 1 and monotonic.
  expect(childStart.length).toBe(count + 1)
  for (let i = 0; i < count; i++) {
    expect(childStart[i + 1]!).toBeGreaterThanOrEqual(childStart[i]!)
  }

  // childStart[count] === childIndex.length === count - roots.length.
  expect(childStart[count]).toBe(count - roots.length)
  expect(childIndex.length).toBe(count - roots.length)

  // Every childIndex entry is in range, points back to its parent via
  // `parent[]`, and every non-root is listed exactly once (roots never are).
  const listedAsChild = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const from = childStart[i]!
    const to = childStart[i + 1]!
    for (let c = from; c < to; c++) {
      const child = childIndex[c]!
      expect(child).toBeGreaterThanOrEqual(0)
      expect(child).toBeLessThan(count)
      expect(parent[child]).toBe(i)
      expect(listedAsChild[child]).toBe(0)
      listedAsChild[child] = 1
    }
  }
  for (let i = 0; i < count; i++) {
    expect(listedAsChild[i]).toBe(parent[i] === -1 ? 0 : 1)
  }

  // roots is exactly the parent === -1 set, in ascending dense-index order
  // (which is input order among top-level nodes).
  const expectedRoots: number[] = []
  for (let i = 0; i < count; i++) if (parent[i] === -1) expectedRoots.push(i)
  expect(Array.from(roots)).toEqual(expectedRoots)

  // depth[i] === depth[parent[i]] + 1, roots are depth 0.
  for (let i = 0; i < count; i++) {
    const p = parent[i]!
    expect(depth[i]).toBe(p === -1 ? 0 : depth[p]! + 1)
  }

  // order is a genuine preorder permutation: reconstruct preorder from the
  // (already-validated) CSR structure with an explicit stack, and require an
  // exact match. This catches `order` drifting from `childStart`/`childIndex`
  // even though both individually look plausible.
  expect(order.length).toBe(count)
  const seenInOrder = new Uint8Array(count)
  for (const idx of order) {
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(count)
    expect(seenInOrder[idx]).toBe(0)
    seenInOrder[idx] = 1
  }
  const reconstructed: number[] = []
  const stack: number[] = []
  for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]!)
  while (stack.length > 0) {
    const node = stack.pop()!
    reconstructed.push(node)
    const from = childStart[node]!
    const to = childStart[node + 1]!
    for (let c = to - 1; c >= from; c--) stack.push(childIndex[c]!)
  }
  expect(Array.from(order)).toEqual(reconstructed)
}

/** Deterministic PRNG (mulberry32) so a failing fuzz case reproduces exactly. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random forest: each node after the first either roots or attaches to an
 * earlier node, so it is cycle-free and duplicate-free by construction. */
function randomForest(rng: () => number, size: number): { id: string; parentId?: string }[] {
  const data: { id: string; parentId?: string }[] = []
  for (let i = 0; i < size; i++) {
    const id = `n${i}`
    if (i === 0 || rng() < 0.15) {
      data.push({ id })
    } else {
      const parentIndex = Math.floor(rng() * i)
      data.push({ id, parentId: `n${parentIndex}` })
    }
  }
  return data
}

function randomMask(rng: () => number, count: number): Uint8Array {
  const mask = new Uint8Array(count)
  for (let i = 0; i < count; i++) mask[i] = rng() < 0.5 ? 1 : 0
  return mask
}

describe('pruneToVisible invariants (seeded fuzz)', () => {
  const seeds = [1, 2, 3, 4, 5, 12345, 999999]

  it('holds over seeded random forests with partial open/closed masks', () => {
    for (const seed of seeds) {
      const rng = mulberry32(seed)
      const data = randomForest(rng, 60)
      const tree = normalize(data)
      const mask = randomMask(rng, tree.count)
      const v = pruneToVisible(tree, mask)
      assertTreeInvariants(v.tree)

      // Cross-check toSource/fromSource are consistent inverses over the
      // visible set, independent of the invariants above.
      for (let visIdx = 0; visIdx < v.tree.count; visIdx++) {
        const src = v.toSource[visIdx]!
        expect(v.fromSource[src]).toBe(visIdx)
      }
    }
  })

  it('holds over seeded random forests with everything open (full tree kept)', () => {
    for (const seed of seeds) {
      const rng = mulberry32(seed)
      const data = randomForest(rng, 40)
      const tree = normalize(data)
      const v = pruneToVisible(tree, allOpen(tree.count))
      assertTreeInvariants(v.tree)
      expect(v.tree.count).toBe(tree.count)
    }
  })

  it('holds over seeded random forests with everything closed (roots only)', () => {
    for (const seed of seeds) {
      const rng = mulberry32(seed)
      const data = randomForest(rng, 40)
      const tree = normalize(data)
      const v = pruneToVisible(tree, new Uint8Array(tree.count))
      assertTreeInvariants(v.tree)
      expect(v.tree.count).toBe(tree.roots.length)
    }
  })

  it('holds on an alternating open/closed chain', () => {
    // n0(open) -> n1(closed) -> n2(open) -> n3(closed) -> ... A closed node
    // hides all its descendants regardless of their own open flag.
    const length = 25
    const data = Array.from({ length }, (_, i) => ({
      id: `n${i}`,
      ...(i === 0 ? {} : { parentId: `n${i - 1}` }),
    }))
    const tree = normalize(data)
    const open = new Uint8Array(length)
    for (let i = 0; i < length; i++) open[i] = i % 2 === 0 ? 1 : 0
    const v = pruneToVisible(tree, open)
    assertTreeInvariants(v.tree)
    // n0 open reveals n1; n1 closed hides n2 onward.
    expect(v.tree.count).toBe(2)
    expect(v.tree.indexToId).toEqual(['n0', 'n1'])
  })

  it('holds on a forest combined with a partial mask (deterministic, non-random)', () => {
    const data = [
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'a' },
      { id: 'e' }, // second root
      { id: 'f', parentId: 'e' },
      { id: 'g', parentId: 'f' },
    ]
    const tree = normalize(data)
    const open = allOpen(tree.count)
    open[tree.idToIndex.get('b')!] = 0 // close 'b': hides 'c'
    open[tree.idToIndex.get('e')!] = 0 // close 'e': hides 'f', 'g'
    const v = pruneToVisible(tree, open)
    assertTreeInvariants(v.tree)
    expect(v.tree.indexToId).toEqual(['a', 'b', 'd', 'e'])
  })
})

describe('pruneToVisible with an isolate root', () => {
  // a -> b -> d, a -> c
  const tree = normalize([
    { id: 'a' },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'a' },
    { id: 'd', parentId: 'b' },
  ])
  const allOpen = new Uint8Array(tree.count).fill(1)

  it('keeps the isolated node and its open descendants, and nothing else', () => {
    const pruned = pruneToVisible(tree, allOpen, tree.idToIndex.get('b')!)
    expect([...pruned.toSource].map((i) => tree.indexToId[i])).toEqual(['b', 'd'])
  })

  it('makes the isolated node a root, whatever its parent is', () => {
    const pruned = pruneToVisible(tree, allOpen, tree.idToIndex.get('b')!)
    expect(pruned.tree.parent[0]).toBe(-1)
    expect(pruned.tree.roots.length).toBe(1)
  })

  it('still hides the descendants of a closed node inside the isolated branch', () => {
    const open = new Uint8Array(tree.count).fill(1)
    open[tree.idToIndex.get('b')!] = 0
    const pruned = pruneToVisible(tree, open, tree.idToIndex.get('b')!)
    expect([...pruned.toSource].map((i) => tree.indexToId[i])).toEqual(['b'])
  })

  it('prunes the whole forest when no root is given', () => {
    expect(pruneToVisible(tree, allOpen).tree.count).toBe(4)
  })
})
