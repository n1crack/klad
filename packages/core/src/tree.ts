import type { NodeData, Warning } from './types.js'

export interface Tree {
  /** Number of unique nodes. */
  count: number
  /** Dense index -> user id. */
  indexToId: string[]
  /** User id -> dense index. */
  idToIndex: Map<string, number>
  /** Parent index per node, -1 for roots. */
  parent: Int32Array
  /** CSR offsets, length count + 1. Children of i are childIndex[childStart[i] .. childStart[i+1]). */
  childStart: Int32Array
  /** CSR payload, length count - roots.length (every non-root appears exactly once). */
  childIndex: Int32Array
  /** Root indices, in input order. */
  roots: Int32Array
  /** Depth per node, roots are 0. */
  depth: Int32Array
  /** Preorder traversal: parents always precede their children. */
  order: Int32Array
  warnings: Warning[]
}

/**
 * Builds the flat index structures every other core module reads.
 * Never recurses: a 50k-deep chain is a supported input.
 */
export function normalize(data: readonly NodeData[]): Tree {
  const warnings: Warning[] = []

  // Pass 1: assign dense indices, last duplicate wins.
  const idToIndex = new Map<string, number>()
  const indexToId: string[] = []
  const rawParentId: (string | null)[] = []
  const duplicates = new Set<string>()

  for (const node of data) {
    const existing = idToIndex.get(node.id)
    const parentId = node.parentId ?? null
    if (existing === undefined) {
      idToIndex.set(node.id, indexToId.length)
      indexToId.push(node.id)
      rawParentId.push(parentId)
    } else {
      duplicates.add(node.id)
      rawParentId[existing] = parentId
    }
  }

  for (const id of duplicates) {
    warnings.push({ code: 'duplicate-id', detail: `id "${id}" appears more than once`, ids: [id] })
  }

  const count = indexToId.length
  const parent = new Int32Array(count).fill(-1)

  // Pass 2: resolve parents. Unresolvable parents become roots.
  for (let i = 0; i < count; i++) {
    const pid = rawParentId[i]
    if (pid === null || pid === undefined) continue
    const p = idToIndex.get(pid)
    if (p === undefined) {
      warnings.push({
        code: 'orphan-parent',
        detail: `parent "${pid}" not found`,
        ids: [indexToId[i]!],
      })
      continue
    }
    parent[i] = p
  }

  // Pass 3: break cycles. Colour marking, iterative, no recursion.
  // 0 = unvisited, 1 = on the current path, 2 = settled.
  // Non-null assertions below (`parent[node]!` etc.) are safe throughout this
  // function: every index used is either a loop counter bounded by `count`
  // or a value read from `parent`, which is only ever populated with -1 or
  // another in-range index (see pass 2). That invariant does NOT hold for
  // the exported `subtreeOf`/`wouldCreateCycle` below, whose indices are
  // supplied by external callers — see the bounds checks there instead of `!`.
  const colour = new Uint8Array(count)
  const path: number[] = []
  for (let start = 0; start < count; start++) {
    if (colour[start] !== 0) continue
    path.length = 0
    let node = start
    while (node !== -1 && colour[node] === 0) {
      colour[node] = 1
      path.push(node)
      node = parent[node]!
    }
    if (node !== -1 && colour[node] === 1) {
      // Found a back-edge into the current path. Root the node it points at.
      const cycleStart = path.indexOf(node)
      const cycle = path.slice(cycleStart)
      warnings.push({
        code: 'cycle',
        detail: `cycle detected: ${cycle.map((i) => indexToId[i]).join(' -> ')}`,
        ids: cycle.map((i) => indexToId[i]!),
      })
      parent[node] = -1
    }
    for (const n of path) colour[n] = 2
  }

  // Pass 4: CSR children, preserving input order among siblings.
  const childStart = new Int32Array(count + 1)
  for (let i = 0; i < count; i++) {
    const p = parent[i]!
    if (p !== -1) childStart[p + 1]!++
  }
  for (let i = 0; i < count; i++) childStart[i + 1]! += childStart[i]!
  const cursor = Int32Array.from(childStart.subarray(0, count))
  let rootCount = 0
  for (let i = 0; i < count; i++) if (parent[i] === -1) rootCount++
  // Length count - rootCount, matching pruneToVisible's Tree producer and the
  // Tree doc comment: every non-root appears exactly once, roots never do.
  const childIndex = new Int32Array(count - rootCount)
  const rootList: number[] = []
  for (let i = 0; i < count; i++) {
    const p = parent[i]!
    if (p === -1) rootList.push(i)
    else childIndex[cursor[p]!++] = i
  }
  const roots = Int32Array.from(rootList)

  // Pass 5: preorder and depth, using an explicit stack.
  const order = new Int32Array(count)
  const depth = new Int32Array(count)
  let cursorOut = 0
  const stack: number[] = []
  for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]!)
  while (stack.length > 0) {
    const node = stack.pop()!
    order[cursorOut++] = node
    const p = parent[node]!
    depth[node] = p === -1 ? 0 : depth[p]! + 1
    const from = childStart[node]!
    const to = childStart[node + 1]!
    for (let c = to - 1; c >= from; c--) stack.push(childIndex[c]!)
  }

  return { count, indexToId, idToIndex, parent, childStart, childIndex, roots, depth, order, warnings }
}

/**
 * Returns the node plus every descendant, in preorder.
 * Returns an empty array for an out-of-range index — unlike `normalize()`,
 * indices here come from the caller and are not guaranteed to be in range,
 * so they must be validated before any `!` indexed access is safe.
 */
export function subtreeOf(tree: Tree, index: number): Int32Array {
  if (index < 0 || index >= tree.count) return new Int32Array(0)
  const out: number[] = []
  const stack = [index]
  while (stack.length > 0) {
    const node = stack.pop()!
    out.push(node)
    const from = tree.childStart[node]!
    const to = tree.childStart[node + 1]!
    for (let c = to - 1; c >= from; c--) stack.push(tree.childIndex[c]!)
  }
  return Int32Array.from(out)
}

/**
 * True when making `newParent` the parent of `index` would form a cycle.
 * Both indices are caller-supplied (e.g. computed by drag-drop reparenting)
 * and are not guaranteed to be in range, so they are validated up front —
 * an out-of-range `parent[]` read returns `undefined`, not `-1`, and
 * `undefined !== -1` would otherwise loop forever climbing the parent chain.
 * An invalid index/newParent cannot create a cycle, so this returns `false`;
 * callers are responsible for rejecting invalid indices on their own terms.
 */
export function wouldCreateCycle(tree: Tree, index: number, newParent: number): boolean {
  if (index < 0 || index >= tree.count) return false
  if (newParent < 0 || newParent >= tree.count) return false
  let node: number = newParent
  while (node !== -1) {
    if (node === index) return true
    node = tree.parent[node]!
  }
  return false
}
