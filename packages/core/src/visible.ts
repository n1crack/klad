import type { Tree } from './tree.js'

export interface VisibleTree {
  /** A fully valid Tree containing only visible nodes. */
  tree: Tree
  /** Visible index -> original index. */
  toSource: Int32Array
  /** Original index -> visible index, or -1 when hidden. */
  fromSource: Int32Array
}

/**
 * Prunes `tree` to the nodes reachable without passing through a closed parent.
 * `open[i] === 1` means node `i` reveals its children; a closed node is still
 * visible itself.
 *
 * Walks the source tree in preorder, which guarantees a parent is decided before
 * its children — no recursion, so a 50k-deep chain is fine. Visible indices are
 * assigned in that same preorder, so the returned tree's `order` is simply
 * `0..count-1`.
 */
export function pruneToVisible(tree: Tree, open: Uint8Array): VisibleTree {
  const n = tree.count
  const fromSource = new Int32Array(n).fill(-1)
  const kept: number[] = []

  for (let k = 0; k < n; k++) {
    const src = tree.order[k]!
    const p = tree.parent[src]!
    if (p !== -1) {
      // Hidden if the parent is hidden, or visible but closed.
      if (fromSource[p] === -1 || open[p] !== 1) continue
    }
    fromSource[src] = kept.length
    kept.push(src)
  }

  const count = kept.length
  const toSource = Int32Array.from(kept)
  const parent = new Int32Array(count)
  const indexToId: string[] = new Array(count)
  const idToIndex = new Map<string, number>()
  const depth = new Int32Array(count)
  const order = new Int32Array(count)

  const childCount = new Int32Array(count)
  const rootList: number[] = []

  for (let i = 0; i < count; i++) {
    const src = toSource[i]!
    const srcParent = tree.parent[src]!
    const p = srcParent === -1 ? -1 : fromSource[srcParent]!
    parent[i] = p
    if (p === -1) rootList.push(i)
    else childCount[p]!++
    indexToId[i] = tree.indexToId[src]!
    idToIndex.set(indexToId[i]!, i)
    depth[i] = p === -1 ? 0 : depth[p]! + 1
    order[i] = i
  }

  const childStart = new Int32Array(count + 1)
  for (let i = 0; i < count; i++) childStart[i + 1] = childStart[i]! + childCount[i]!
  const cursor = Int32Array.from(childStart.subarray(0, count))
  const childIndex = new Int32Array(count - rootList.length)
  for (let i = 0; i < count; i++) {
    const p = parent[i]!
    if (p !== -1) childIndex[cursor[p]!++] = i
  }

  const tree2: Tree = {
    count,
    indexToId,
    idToIndex,
    parent,
    childStart,
    childIndex,
    roots: Int32Array.from(rootList),
    depth,
    order,
    warnings: [],
  }

  return { tree: tree2, toSource, fromSource }
}
