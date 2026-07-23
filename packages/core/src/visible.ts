import type { Tree } from './tree.js'

export interface VisibleTree {
  /**
   * A fully valid Tree containing only visible nodes. It is derived, not
   * parsed, so its `warnings` is always `[]` — every `duplicate-id`,
   * `orphan-parent`, and `cycle` diagnostic lives on the source `Tree` passed
   * into `pruneToVisible`, not on `visibleTree.tree`. Read diagnostics from
   * the source tree.
   */
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
 * `isolateRoot` re-roots the result at one node: that node and its open
 * descendants, and nothing else — not its siblings, not its ancestors, not the
 * other roots. Everything downstream then treats it AS the tree, which is what
 * makes "show me only this branch" a pruning question rather than a special
 * case threaded through layout, bounds, hit-testing and export. `-1` (the
 * default) prunes the whole forest as before.
 *
 * Walks the source tree in preorder, which guarantees a parent is decided before
 * its children — no recursion, so a 50k-deep chain is fine. Visible indices are
 * assigned in that same preorder, so the returned tree's `order` is simply
 * `0..count-1`.
 */
export function pruneToVisible(tree: Tree, open: Uint8Array, isolateRoot = -1): VisibleTree {
  const n = tree.count
  const fromSource = new Int32Array(n).fill(-1)
  const kept: number[] = []

  for (let k = 0; k < n; k++) {
    const src = tree.order[k]!
    // The isolate root is kept whatever its own parent says — it is a root
    // now. Its descendants need no special handling at all: preorder means
    // their ancestors were decided first, so the ordinary rule below keeps
    // exactly the open ones and drops everything outside the subtree, whose
    // parents were never kept.
    if (src !== isolateRoot) {
      const p = tree.parent[src]!
      // While isolating, a genuine root that is not THE root is out — it has
      // no parent to have been excluded by.
      if (isolateRoot !== -1 && p === -1) continue
      if (p !== -1) {
        // Hidden if the parent is hidden, or visible but closed.
        if (fromSource[p] === -1 || open[p] !== 1) continue
      }
    }
    fromSource[src] = kept.length
    kept.push(src)
  }

  const count = kept.length
  const toSource = Int32Array.from(kept)
  const parent = new Int32Array(count)
  const indexToId: string[] = Array.from({ length: count })
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
