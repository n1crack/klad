# Klados Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless, framework-agnostic layout engine for Klados v1.0 — tree normalization, linear-time tidy layout, orientations, spatial indexing, and the pan/zoom viewport — all pure TypeScript with no DOM.

**Architecture:** A pnpm monorepo. `packages/core` holds pure TypeScript with zero runtime dependencies. Every module in this plan is DOM-free and worker-safe, so it tests directly in Node. Node data is stored in flat typed arrays indexed by a dense `uint32` node index; the user's string ids exist only at the API boundary. Tree walks are iterative with explicit ordering arrays, never recursive, so a 50,000-node chain cannot overflow the stack.

**Tech Stack:** TypeScript 5.9 (pinned), pnpm workspaces, turbo, vitest 4, oxlint, prettier. Build tooling (tsdown) and rendering arrive in Plan 2 — this plan produces a library that is imported by tests only.

## Global Constraints

- **Zero third-party runtime dependencies** in `packages/core`. Dev dependencies are unrestricted.
- **TypeScript pinned to 5.9.x.** TS 7.0 is GA but `vue-tsc` cannot support it until TS 7.1. Do not upgrade.
- **ESM only.** No CJS output, no `require`, `"type": "module"` everywhere.
- **No DOM, no `window`, no `document`** anywhere in `packages/core/src`. These modules must run inside a Web Worker.
- **No recursion over tree nodes.** Depth can reach 50,000. Use explicit ordering arrays or stacks.
- **Public API uses `string` ids. Internals use dense `uint32` indices.** `tree.ts` owns the mapping and is the only module aware of both.
- **Node package scope:** `@klados/core`.
- **Performance budget:** 50,000-node cold layout under 400ms. Enforced by a test in Task 3.
- Spec of record: `docs/superpowers/specs/2026-07-21-orgchart-rework-design.md`.

---

### Task 1: Monorepo scaffold

Replaces the v0.2.5 single-package layout with a pnpm workspace. The old `src/` and `examples/` are removed — v1.0 shares no code with them, and they remain in git history.

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.npmrc`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/version.test.ts`
- Modify: `package.json` (replace entirely — becomes the workspace root)
- Modify: `.gitignore`
- Delete: `src/`, `examples/`, `dist/`, `index.html`, `vite.config.ts`, `postcss.config.cjs`, `env.d.ts`, `tsconfig.app.json`, `tsconfig.node.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `pnpm test` at the repo root; the `@klados/core` package that every later task adds files to.

- [ ] **Step 1: Remove the v0.2.5 source tree**

The old implementation is superseded in full. It stays recoverable in git history at commit `46914f0`.

```bash
git rm -r src examples index.html vite.config.ts postcss.config.cjs env.d.ts tsconfig.app.json tsconfig.node.json
git rm -r --cached dist 2>/dev/null || true
rm -rf dist node_modules
```

- [ ] **Step 2: Write the workspace root files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

`.npmrc`:

```ini
strict-peer-dependencies=false
auto-install-peers=false
```

`package.json` (replaces the existing file entirely):

```json
{
  "name": "klados-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.13.1",
  "engines": {
    "node": ">=22.12.0"
  },
  "scripts": {
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "oxlint packages",
    "format": "prettier --write \"packages/**/*.{ts,vue,json,md}\""
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "oxlint": "^1.0.0",
    "prettier": "^3.4.0",
    "turbo": "^2.3.0",
    "typescript": "5.9.2",
    "vitest": "^4.1.0"
  }
}
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    }
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore` — append these lines to the existing file:

```gitignore
node_modules/
dist/
.turbo/
*.tsbuildinfo
```

- [ ] **Step 3: Write the core package files**

`packages/core/package.json`:

```json
{
  "name": "@klados/core",
  "version": "1.0.0-alpha.0",
  "type": "module",
  "license": "MIT",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": []
  },
  "include": ["src"]
}
```

`"types": []` is deliberate — it keeps `@types/node` globals out of core, so any accidental use of Node or DOM APIs fails typecheck.

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

`packages/core/src/index.ts`:

```ts
export const VERSION = '1.0.0-alpha.0'
```

- [ ] **Step 4: Write the failing test**

`packages/core/src/version.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { VERSION } from './index.js'

describe('package', () => {
  it('exports a version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
```

- [ ] **Step 5: Install and run the test**

Run:

```bash
pnpm install
pnpm test
```

Expected: turbo runs `@klados/core#test`, vitest reports `1 passed`.

If `pnpm install` reports the lockfile is for a different workspace shape, delete `pnpm-lock.yaml` and rerun — the old lockfile describes the deleted single-package layout.

- [ ] **Step 6: Verify typecheck passes**

Run:

```bash
pnpm typecheck
```

Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: replace v0.2.5 layout with pnpm monorepo scaffold"
```

---

### Task 2: Tree normalization and id mapping

Turns user `NodeData[]` into flat typed arrays: a dense index per node, a parent array, and children in CSR (compressed sparse row) form. This is the only module that knows about both string ids and numeric indices.

**Ambiguity resolved here:** the spec says cycles are "rejected at load, emits warning." This is implemented as: the back-edge is dropped, the node becomes a root, and a `cycle` warning carries the offending path. The chart still renders rather than failing outright.

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/tree.ts`
- Create: `packages/core/src/tree.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type NodeData = { id: string; parentId?: string | null; [k: string]: unknown }`
  - `type WarningCode = 'duplicate-id' | 'orphan-parent' | 'cycle'`
  - `type Warning = { code: WarningCode; detail: string; ids: string[] }`
  - `interface Tree { count: number; indexToId: string[]; idToIndex: Map<string, number>; parent: Int32Array; childStart: Int32Array; childIndex: Int32Array; roots: Int32Array; depth: Int32Array; order: Int32Array; warnings: Warning[] }`
  - `function normalize(data: readonly NodeData[]): Tree`
  - `function subtreeOf(tree: Tree, index: number): Int32Array`
  - `function wouldCreateCycle(tree: Tree, index: number, newParent: number): boolean`

`order` is preorder (parents before children). Later tasks read it forwards for top-down passes and backwards for bottom-up passes — this is what replaces recursion.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/tree.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @klados/core test
```

Expected: FAIL — `Failed to resolve import "./tree.js"`.

- [ ] **Step 3: Write the types**

`packages/core/src/types.ts`:

```ts
export interface NodeData {
  id: string
  parentId?: string | null
  [key: string]: unknown
}

export type WarningCode = 'duplicate-id' | 'orphan-parent' | 'cycle'

export interface Warning {
  code: WarningCode
  detail: string
  ids: string[]
}

export interface Size {
  w: number
  h: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
```

- [ ] **Step 4: Write the implementation**

`packages/core/src/tree.ts`:

```ts
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
  /** CSR payload, length count. */
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
  const childIndex = new Int32Array(count)
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

/** Returns the node plus every descendant, in preorder. */
export function subtreeOf(tree: Tree, index: number): Int32Array {
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

/** True when making `newParent` the parent of `index` would form a cycle. */
export function wouldCreateCycle(tree: Tree, index: number, newParent: number): boolean {
  let node: number = newParent
  while (node !== -1) {
    if (node === index) return true
    node = tree.parent[node]!
  }
  return false
}
```

- [ ] **Step 5: Export from the package entry**

`packages/core/src/index.ts`:

```ts
export const VERSION = '1.0.0-alpha.0'

export type { NodeData, Warning, WarningCode, Size, Bounds } from './types.js'
export type { Tree } from './tree.js'
export { normalize, subtreeOf, wouldCreateCycle } from './tree.js'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @klados/core test
pnpm typecheck
```

Expected: all `tree.test.ts` cases pass; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/tree.ts packages/core/src/tree.test.ts packages/core/src/index.ts
git commit -m "feat(core): tree normalization, id mapping, cycle and orphan handling"
```

---

### Task 3: Tidy tree layout

Implements van der Ploeg's "Drawing Non-layered Tidy Trees in Linear Time" over the flat arrays from Task 2. Variable node sizes are supported natively, which is why this is written from scratch rather than ported from `d3-hierarchy` (fixed sizes only, and a runtime dependency).

The paper's algorithm is recursive; here both walks are driven by `tree.order` instead. `firstWalk` runs over `order` **backwards** (children always settled before their parent), `secondWalk` runs **forwards**.

Layout is computed in a canonical top-to-bottom space. Orientation is applied afterwards in Task 4.

**Files:**
- Create: `packages/core/src/layout/tidy.ts`
- Create: `packages/core/src/layout/tidy.test.ts`
- Create: `packages/core/src/layout/tidy.bench.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Tree` from `tree.ts`; `Size`, `Bounds` from `types.ts`.
- Produces:
  - `interface LayoutOptions { spacingX: number; spacingY: number }`
  - `interface LayoutResult { boxes: Float64Array; bounds: Bounds }` — `boxes` holds `[x, y, w, h]` per node, so node `i` occupies `boxes[i * 4 .. i * 4 + 3]`. Indices match `Tree` indices.
  - `function layout(tree: Tree, sizes: Float64Array, opts: LayoutOptions): LayoutResult` — `sizes` holds `[w, h]` per node, length `count * 2`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/layout/tidy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { layout } from './tidy.js'
import type { NodeData } from '../types.js'

const OPTS = { spacingX: 10, spacingY: 20 }

/** Builds a uniform size array so tests can focus on positions. */
function uniformSizes(count: number, w = 100, h = 50): Float64Array {
  const sizes = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    sizes[i * 2] = w
    sizes[i * 2 + 1] = h
  }
  return sizes
}

function boxOf(tree: ReturnType<typeof normalize>, boxes: Float64Array, id: string) {
  const i = tree.idToIndex.get(id)!
  return { x: boxes[i * 4]!, y: boxes[i * 4 + 1]!, w: boxes[i * 4 + 2]!, h: boxes[i * 4 + 3]! }
}

describe('layout', () => {
  it('places a single node at the origin', () => {
    const tree = normalize([{ id: 'a' }])
    const { boxes, bounds } = layout(tree, uniformSizes(1), OPTS)
    expect(boxOf(tree, boxes, 'a')).toEqual({ x: 0, y: 0, w: 100, h: 50 })
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 })
  })

  it('stacks depth by parent height plus spacingY', () => {
    const tree = normalize([{ id: 'a' }, { id: 'b', parentId: 'a' }])
    const { boxes } = layout(tree, uniformSizes(2), OPTS)
    expect(boxOf(tree, boxes, 'a').y).toBe(0)
    expect(boxOf(tree, boxes, 'b').y).toBe(70) // 50 height + 20 spacingY
  })

  it('separates siblings by spacingX and centres the parent over them', () => {
    const tree = normalize([
      { id: 'a' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'a' },
    ])
    const { boxes } = layout(tree, uniformSizes(3), OPTS)
    const b = boxOf(tree, boxes, 'b')
    const c = boxOf(tree, boxes, 'c')
    const a = boxOf(tree, boxes, 'a')

    expect(c.x - b.x).toBe(110) // 100 width + 10 spacingX
    const childrenCentre = (b.x + c.x + c.w) / 2
    expect(a.x + a.w / 2).toBeCloseTo(childrenCentre, 6)
  })

  it('never overlaps siblings of differing widths', () => {
    const tree = normalize([
      { id: 'a' },
      { id: 'wide', parentId: 'a' },
      { id: 'narrow', parentId: 'a' },
    ])
    const sizes = uniformSizes(3)
    sizes[tree.idToIndex.get('wide')! * 2] = 300
    sizes[tree.idToIndex.get('narrow')! * 2] = 40

    const { boxes } = layout(tree, sizes, OPTS)
    const wide = boxOf(tree, boxes, 'wide')
    const narrow = boxOf(tree, boxes, 'narrow')
    expect(narrow.x).toBeGreaterThanOrEqual(wide.x + wide.w + OPTS.spacingX)
  })

  it('never overlaps any two boxes on the same row, in a deep ragged tree', () => {
    const data: NodeData[] = [{ id: 'root' }]
    for (let i = 0; i < 40; i++) {
      data.push({ id: `l1-${i}`, parentId: 'root' })
      for (let j = 0; j < (i % 5); j++) {
        data.push({ id: `l2-${i}-${j}`, parentId: `l1-${i}` })
        for (let k = 0; k < (j % 3); k++) {
          data.push({ id: `l3-${i}-${j}-${k}`, parentId: `l2-${i}-${j}` })
        }
      }
    }
    const tree = normalize(data)
    const sizes = new Float64Array(tree.count * 2)
    for (let i = 0; i < tree.count; i++) {
      sizes[i * 2] = 40 + ((i * 37) % 120) // varied widths
      sizes[i * 2 + 1] = 50
    }

    const { boxes } = layout(tree, sizes, OPTS)

    const byRow = new Map<number, number[]>()
    for (let i = 0; i < tree.count; i++) {
      const y = boxes[i * 4 + 1]!
      const row = byRow.get(y) ?? []
      row.push(i)
      byRow.set(y, row)
    }
    for (const row of byRow.values()) {
      row.sort((p, q) => boxes[p * 4]! - boxes[q * 4]!)
      for (let n = 1; n < row.length; n++) {
        const prev = row[n - 1]!
        const cur = row[n]!
        const prevRight = boxes[prev * 4]! + boxes[prev * 4 + 2]!
        expect(boxes[cur * 4]!).toBeGreaterThanOrEqual(prevRight + OPTS.spacingX - 1e-6)
      }
    }
  })

  it('lays out a forest without overlapping the roots', () => {
    const tree = normalize([{ id: 'a' }, { id: 'b' }])
    const { boxes } = layout(tree, uniformSizes(2), OPTS)
    const a = boxOf(tree, boxes, 'a')
    const b = boxOf(tree, boxes, 'b')
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.w + OPTS.spacingX)
  })

  it('returns empty bounds for empty input', () => {
    const tree = normalize([])
    const { boxes, bounds } = layout(tree, new Float64Array(0), OPTS)
    expect(boxes.length).toBe(0)
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })

  it('survives a 50k-deep chain without a stack overflow', () => {
    const data = Array.from({ length: 50_000 }, (_, i) => ({
      id: `n${i}`,
      ...(i === 0 ? {} : { parentId: `n${i - 1}` }),
    }))
    const tree = normalize(data)
    const { boxes } = layout(tree, uniformSizes(tree.count), OPTS)
    expect(boxes[(50_000 - 1) * 4 + 1]).toBe(49_999 * 70)
  })
})
```

`packages/core/src/layout/tidy.bench.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalize } from '../tree.js'
import { layout } from './tidy.js'
import type { NodeData } from '../types.js'

/** Builds a bushy 50k-node tree: branching factor 10, four levels deep. */
function build50k(): NodeData[] {
  const data: NodeData[] = [{ id: 'root' }]
  let frontier = ['root']
  while (data.length < 50_000) {
    const next: string[] = []
    for (const parentId of frontier) {
      for (let i = 0; i < 10 && data.length < 50_000; i++) {
        const id = `${parentId}.${i}`
        data.push({ id, parentId })
        next.push(id)
      }
    }
    frontier = next
  }
  return data
}

describe('layout performance budget', () => {
  it('lays out 50k nodes in under 400ms', () => {
    const tree = normalize(build50k())
    const sizes = new Float64Array(tree.count * 2)
    for (let i = 0; i < tree.count; i++) {
      sizes[i * 2] = 220
      sizes[i * 2 + 1] = 96
    }

    // Warm up so the measured run is not dominated by first-call JIT compilation.
    layout(tree, sizes, { spacingX: 16, spacingY: 48 })

    const start = performance.now()
    layout(tree, sizes, { spacingX: 16, spacingY: 48 })
    const elapsed = performance.now() - start

    expect(tree.count).toBe(50_000)
    expect(elapsed).toBeLessThan(400)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @klados/core test
```

Expected: FAIL — `Failed to resolve import "./tidy.js"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/layout/tidy.ts`:

```ts
import type { Tree } from '../tree.js'
import type { Bounds } from '../types.js'

export interface LayoutOptions {
  /** Minimum horizontal gap between adjacent boxes. */
  spacingX: number
  /** Vertical gap between a node's bottom edge and its children's top edge. */
  spacingY: number
}

export interface LayoutResult {
  /** [x, y, w, h] per node; node i occupies boxes[i * 4 .. i * 4 + 3]. */
  boxes: Float64Array
  bounds: Bounds
}

const NONE = -1

/**
 * Non-layered tidy tree layout (van der Ploeg, linear time), adapted to flat
 * typed arrays and driven by tree.order instead of recursion.
 *
 * A virtual super-root is not allocated. Instead a forest is laid out by
 * treating the roots as siblings via the same separation pass.
 */
export function layout(tree: Tree, sizes: Float64Array, opts: LayoutOptions): LayoutResult {
  const n = tree.count
  const boxes = new Float64Array(n * 4)
  if (n === 0) {
    return { boxes, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  }

  const { parent, childStart, childIndex, order, roots } = tree

  // Per-node algorithm state.
  const prelim = new Float64Array(n)
  const mod = new Float64Array(n)
  const shift = new Float64Array(n)
  const change = new Float64Array(n)
  const msel = new Float64Array(n) // mod sum of the extreme-left descendant
  const mser = new Float64Array(n) // mod sum of the extreme-right descendant
  const el = new Int32Array(n) // extreme-left descendant
  const er = new Int32Array(n) // extreme-right descendant
  const tl = new Int32Array(n).fill(NONE) // thread, left contour
  const tr = new Int32Array(n).fill(NONE) // thread, right contour

  const y = new Float64Array(n)
  const width = (i: number): number => sizes[i * 2]!
  const height = (i: number): number => sizes[i * 2 + 1]!

  // Absolute y is fixed by the parent chain and never changes, so resolve it up
  // front in preorder. This is what makes the tree "non-layered": a node's depth
  // position depends on its ancestors' heights, not on a uniform row height.
  for (let k = 0; k < n; k++) {
    const i = order[k]!
    const p = parent[i]!
    y[i] = p === NONE ? 0 : y[p]! + height(p) + opts.spacingY
  }

  const bottom = (i: number): number => y[i]! + height(i)

  // Intervals of low y, as a linked list held in parallel arrays. Reused across
  // every separation pass; `iylTop` points at the head, NONE means empty.
  const iylLowY: number[] = []
  const iylIndex: number[] = []
  const iylNext: number[] = []
  let iylTop = NONE

  const iylReset = (): void => {
    iylLowY.length = 0
    iylIndex.length = 0
    iylNext.length = 0
    iylTop = NONE
  }
  const iylPush = (lowY: number, index: number): void => {
    // Drop entries that this one covers.
    while (iylTop !== NONE && lowY >= iylLowY[iylTop]!) iylTop = iylNext[iylTop]!
    iylLowY.push(lowY)
    iylIndex.push(index)
    iylNext.push(iylTop)
    iylTop = iylLowY.length - 1
  }

  /**
   * Distributes `dist` evenly across the siblings between `si` and `i`, so that
   * a shift caused by one pair does not bunch the nodes in between.
   * `sibs` is the sibling list (CSR slice, or the root list for the forest pass).
   */
  const distributeExtra = (
    sibs: Int32Array,
    from: number,
    i: number,
    si: number,
    dist: number,
  ): void => {
    if (si === i - 1) return
    const nr = i - si
    shift[sibs[from + si + 1]!]! += dist / nr
    shift[sibs[from + i]!]! -= dist / nr
    change[sibs[from + i]!]! -= dist - dist / nr
  }

  const nextLeftContour = (i: number): number => {
    const from = childStart[i]!
    return childStart[i + 1]! === from ? tl[i]! : childIndex[from]!
  }
  const nextRightContour = (i: number): number => {
    const to = childStart[i + 1]!
    return to === childStart[i]! ? tr[i]! : childIndex[to - 1]!
  }

  /**
   * Pushes sibling `i` far enough right that it clears every sibling to its left.
   * Walks the right contour of the left siblings against the left contour of `i`.
   */
  const separate = (sibs: Int32Array, from: number, i: number): void => {
    let sr = sibs[from + i - 1]!
    let mssr = mod[sr]!
    let cl = sibs[from + i]!
    let mscl = mod[cl]!
    let ih = iylTop

    while (sr !== NONE && cl !== NONE) {
      while (ih !== NONE && bottom(sr) > iylLowY[ih]!) ih = iylNext[ih]!

      const dist = mssr + prelim[sr]! + width(sr) + opts.spacingX - (mscl + prelim[cl]!)
      if (dist > 0) {
        mscl += dist
        // Move the subtree and everything it drags with it.
        mod[sibs[from + i]!]! += dist
        msel[sibs[from + i]!]! += dist
        mser[sibs[from + i]!]! += dist
        distributeExtra(sibs, from, i, ih === NONE ? i - 1 : iylIndex[ih]!, dist)
      }

      const sy = bottom(sr)
      const cy = bottom(cl)
      if (sy <= cy) {
        sr = nextRightContour(sr)
        if (sr !== NONE) mssr += mod[sr]!
      }
      if (sy >= cy) {
        cl = nextLeftContour(cl)
        if (cl !== NONE) mscl += mod[cl]!
      }
    }

    const self = sibs[from + i]!
    const left = sibs[from]!
    const prev = sibs[from + i - 1]!

    if (sr === NONE && cl !== NONE) {
      // The left siblings ran out first: thread down to the current contour.
      const li = el[left]!
      tl[li] = cl
      const diff = mscl - mod[cl]! - msel[left]!
      mod[li]! += diff
      prelim[li]! -= diff
      el[left] = el[self]!
      msel[left] = msel[self]!
    } else if (sr !== NONE && cl === NONE) {
      // The current subtree ran out first: thread up to the left contour.
      const ri = er[self]!
      tr[ri] = sr
      const diff = mssr - mod[sr]! - mser[self]!
      mod[ri]! += diff
      prelim[ri]! -= diff
      er[self] = er[prev]!
      mser[self] = mser[prev]!
    }
  }

  /** Applies accumulated shifts to a sibling run. */
  const addChildSpacing = (sibs: Int32Array, from: number, to: number): void => {
    let d = 0
    let modSumDelta = 0
    for (let k = from; k < to; k++) {
      const c = sibs[k]!
      d += shift[c]!
      modSumDelta += d + change[c]!
      mod[c]! += modSumDelta
    }
  }

  /**
   * Positions one node over its already-settled children and records its
   * extreme descendants. `sibs`/`from`/`to` describe that node's child run.
   */
  const settle = (i: number, sibs: Int32Array, from: number, to: number): void => {
    if (from === to) {
      el[i] = i
      er[i] = i
      msel[i] = 0
      mser[i] = 0
      return
    }

    iylReset()
    iylPush(bottom(el[sibs[from]!]!), 0)
    for (let k = from + 1; k < to; k++) {
      const child = sibs[k]!
      const minY = bottom(er[child]!)
      separate(sibs, from, k - from)
      iylPush(minY, k - from)
    }

    addChildSpacing(sibs, from, to)

    const first = sibs[from]!
    const last = sibs[to - 1]!
    prelim[i] =
      (prelim[first]! + mod[first]! + mod[last]! + prelim[last]! + width(last)) / 2 - width(i) / 2

    el[i] = el[first]!
    msel[i] = msel[first]!
    er[i] = er[last]!
    mser[i] = mser[last]!
  }

  // First walk: children before parents, so iterate preorder backwards.
  for (let k = n - 1; k >= 0; k--) {
    const i = order[k]!
    settle(i, childIndex, childStart[i]!, childStart[i + 1]!)
  }

  // Forest: separate the roots against each other exactly like siblings.
  if (roots.length > 1) {
    iylReset()
    iylPush(bottom(el[roots[0]!]!), 0)
    for (let k = 1; k < roots.length; k++) {
      const minY = bottom(er[roots[k]!]!)
      separate(roots, 0, k)
      iylPush(minY, k)
    }
    addChildSpacing(roots, 0, roots.length)
  }

  // Second walk: parents before children, so iterate preorder forwards.
  // modSum[i] is the accumulated modifier from the root down to i.
  const modSum = new Float64Array(n)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let k = 0; k < n; k++) {
    const i = order[k]!
    const p = parent[i]!
    modSum[i] = (p === NONE ? 0 : modSum[p]!) + mod[i]!
    const x = prelim[i]! + modSum[i]!
    boxes[i * 4] = x
    boxes[i * 4 + 1] = y[i]!
    boxes[i * 4 + 2] = width(i)
    boxes[i * 4 + 3] = height(i)

    if (x < minX) minX = x
    if (y[i]! < minY) minY = y[i]!
    if (x + width(i) > maxX) maxX = x + width(i)
    if (bottom(i) > maxY) maxY = bottom(i)
  }

  // Normalise so the layout starts at the origin.
  if (minX !== 0 || minY !== 0) {
    for (let i = 0; i < n; i++) {
      boxes[i * 4]! -= minX
      boxes[i * 4 + 1]! -= minY
    }
    maxX -= minX
    maxY -= minY
    minX = 0
    minY = 0
  }

  return { boxes, bounds: { minX, minY, maxX, maxY } }
}
```

- [ ] **Step 4: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type { LayoutOptions, LayoutResult } from './layout/tidy.js'
export { layout } from './layout/tidy.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @klados/core test
```

Expected: every `tidy.test.ts` case passes, including the no-overlap property test, and `tidy.bench.test.ts` reports the 50k layout under 400ms.

If the no-overlap test fails, the bug is almost certainly in `separate` — add a temporary log of `dist` per pair and compare against the paper's Figure 6 walkthrough. Do not "fix" it by adding padding to `spacingX`; that hides the defect.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/layout packages/core/src/index.ts
git commit -m "feat(core): linear-time non-layered tidy tree layout"
```

---

### Task 4: Orientation and RTL

Transforms the canonical top-down layout from Task 3 into any of the four orientations, with optional RTL mirroring. This is a pure post-pass over the `boxes` array — the layout algorithm itself never learns about direction.

**Files:**
- Create: `packages/core/src/layout/orientation.ts`
- Create: `packages/core/src/layout/orientation.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Bounds` from `types.ts`; the `boxes`/`bounds` shape from `layout()`.
- Produces:
  - `type Orientation = 'tb' | 'bt' | 'lr' | 'rl'`
  - `function applyOrientation(boxes: Float64Array, bounds: Bounds, orientation: Orientation, rtl: boolean): Bounds` — mutates `boxes` in place and returns the new bounds.

Mutating in place is deliberate: `boxes` is a transferable buffer that will be handed to the worker in Plan 2, and allocating a second copy per relayout at 50k nodes is waste.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/layout/orientation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyOrientation } from './orientation.js'
import type { Bounds } from '../types.js'

/** Two boxes: a 100x50 at the origin and a 60x40 to its lower right. */
function fixture(): { boxes: Float64Array; bounds: Bounds } {
  return {
    boxes: Float64Array.from([0, 0, 100, 50, 20, 70, 60, 40]),
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 110 },
  }
}

describe('applyOrientation', () => {
  it('leaves tb untouched', () => {
    const { boxes, bounds } = fixture()
    const out = applyOrientation(boxes, bounds, 'tb', false)
    expect(Array.from(boxes)).toEqual([0, 0, 100, 50, 20, 70, 60, 40])
    expect(out).toEqual(bounds)
  })

  it('mirrors vertically for bt', () => {
    const { boxes, bounds } = fixture()
    const out = applyOrientation(boxes, bounds, 'bt', false)
    // First box: y becomes 110 - (0 + 50) = 60.
    expect(boxes[1]).toBe(60)
    // Second box: y becomes 110 - (70 + 40) = 0.
    expect(boxes[5]).toBe(0)
    expect(boxes[0]).toBe(0) // x untouched
    expect(out).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 110 })
  })

  it('transposes for lr, swapping both position and size', () => {
    const { boxes, bounds } = fixture()
    const out = applyOrientation(boxes, bounds, 'lr', false)
    // Box 0: (x,y,w,h) 0,0,100,50 -> 0,0,50,100
    expect(Array.from(boxes.slice(0, 4))).toEqual([0, 0, 50, 100])
    // Box 1: 20,70,60,40 -> 70,20,40,60
    expect(Array.from(boxes.slice(4, 8))).toEqual([70, 20, 40, 60])
    expect(out).toEqual({ minX: 0, minY: 0, maxX: 110, maxY: 100 })
  })

  it('transposes then mirrors horizontally for rl', () => {
    const { boxes, bounds } = fixture()
    const out = applyOrientation(boxes, bounds, 'rl', false)
    // After transpose box 0 is 0,0,50,100; mirrored: x = 110 - (0 + 50) = 60.
    expect(boxes[0]).toBe(60)
    // After transpose box 1 is 70,20,40,60; mirrored: x = 110 - (70 + 40) = 0.
    expect(boxes[4]).toBe(0)
    expect(out).toEqual({ minX: 0, minY: 0, maxX: 110, maxY: 100 })
  })

  it('mirrors horizontally when rtl is set on a vertical orientation', () => {
    const { boxes, bounds } = fixture()
    applyOrientation(boxes, bounds, 'tb', true)
    expect(boxes[0]).toBe(0) // 100 - (0 + 100)
    expect(boxes[4]).toBe(20) // 100 - (20 + 60)
  })

  it('is a no-op when rtl cancels rl back to lr ordering', () => {
    const plain = fixture()
    const mirrored = fixture()
    applyOrientation(plain.boxes, plain.bounds, 'lr', false)
    applyOrientation(mirrored.boxes, mirrored.bounds, 'rl', true)
    expect(Array.from(mirrored.boxes)).toEqual(Array.from(plain.boxes))
  })

  it('handles an empty layout', () => {
    const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    const out = applyOrientation(new Float64Array(0), bounds, 'lr', true)
    expect(out).toEqual(bounds)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @klados/core test
```

Expected: FAIL — `Failed to resolve import "./orientation.js"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/layout/orientation.ts`:

```ts
import type { Bounds } from '../types.js'

export type Orientation = 'tb' | 'bt' | 'lr' | 'rl'

/**
 * Rewrites a canonical top-down layout into the requested orientation.
 * Mutates `boxes` in place — it is a transferable buffer and copying it per
 * relayout would be pure waste at 50k nodes.
 *
 * Order of operations: transpose (for horizontal orientations), then mirror.
 * `rtl` mirrors along the cross axis, which is x for tb/bt and stays x for
 * lr/rl, so setting rtl on 'rl' cancels back to 'lr' ordering.
 */
export function applyOrientation(
  boxes: Float64Array,
  bounds: Bounds,
  orientation: Orientation,
  rtl: boolean,
): Bounds {
  const n = boxes.length / 4
  let { maxX, maxY } = bounds

  const horizontal = orientation === 'lr' || orientation === 'rl'
  if (horizontal) {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      const x = boxes[o]!
      const y = boxes[o + 1]!
      const w = boxes[o + 2]!
      const h = boxes[o + 3]!
      boxes[o] = y
      boxes[o + 1] = x
      boxes[o + 2] = h
      boxes[o + 3] = w
    }
    const swap = maxX
    maxX = maxY
    maxY = swap
  }

  // 'bt' flips the main axis, which is vertical only for tb/bt.
  if (orientation === 'bt') {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      boxes[o + 1] = maxY - (boxes[o + 1]! + boxes[o + 3]!)
    }
  }

  // 'rl' flips the main axis for horizontal orientations; rtl flips the cross axis.
  const flipX = (orientation === 'rl') !== rtl
  if (flipX) {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      boxes[o] = maxX - (boxes[o]! + boxes[o + 2]!)
    }
  }

  return { minX: 0, minY: 0, maxX, maxY }
}
```

- [ ] **Step 4: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type { Orientation } from './layout/orientation.js'
export { applyOrientation } from './layout/orientation.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @klados/core test
pnpm typecheck
```

Expected: all `orientation.test.ts` cases pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/layout/orientation.ts packages/core/src/layout/orientation.test.ts packages/core/src/index.ts
git commit -m "feat(core): layout orientations and RTL mirroring"
```

---

### Task 5: Spatial index

A region quadtree over the laid-out boxes. Two consumers: the worker culls to the visible rectangle every frame, and the main thread resolves pointer positions to node indices without a round trip.

Each box is stored in the deepest quad that fully contains it, so a query never needs to test every box. Point queries additionally test exact box bounds, because a quad hit does not imply a box hit.

**Files:**
- Create: `packages/core/src/spatial/quadtree.ts`
- Create: `packages/core/src/spatial/quadtree.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Bounds` from `types.ts`; the `boxes` array from `layout()`.
- Produces:
  - `interface QuadTree { query(rect: Bounds, out: Uint32Array): number; hitTest(x: number, y: number): number }`
  - `function buildQuadTree(boxes: Float64Array, bounds: Bounds, maxDepth?: number): QuadTree`

`query` writes matching indices into the caller's `out` buffer and returns how many it wrote — no per-frame allocation. `hitTest` returns a node index or `-1`. When boxes overlap at a point, the highest index wins (later nodes draw on top).

- [ ] **Step 1: Write the failing tests**

`packages/core/src/spatial/quadtree.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildQuadTree } from './quadtree.js'
import type { Bounds } from '../types.js'

const BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }

/** Four boxes, one per quadrant of a 1000x1000 space. */
function quadrants(): Float64Array {
  return Float64Array.from([
    10, 10, 100, 100, // 0: top-left
    890, 10, 100, 100, // 1: top-right
    10, 890, 100, 100, // 2: bottom-left
    890, 890, 100, 100, // 3: bottom-right
  ])
}

function queryAll(tree: ReturnType<typeof buildQuadTree>, rect: Bounds, capacity = 64): number[] {
  const out = new Uint32Array(capacity)
  const count = tree.query(rect, out)
  return Array.from(out.subarray(0, count)).sort((a, b) => a - b)
}

describe('buildQuadTree', () => {
  it('returns only the boxes overlapping the query rect', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(queryAll(tree, { minX: 0, minY: 0, maxX: 200, maxY: 200 })).toEqual([0])
    expect(queryAll(tree, { minX: 800, minY: 800, maxX: 1000, maxY: 1000 })).toEqual([3])
  })

  it('returns every box for a full-extent query', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(queryAll(tree, BOUNDS)).toEqual([0, 1, 2, 3])
  })

  it('counts a box that straddles the query edge', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    // Rect ends at x=50, box 0 spans 10..110 — they overlap.
    expect(queryAll(tree, { minX: 0, minY: 0, maxX: 50, maxY: 50 })).toEqual([0])
  })

  it('returns nothing for a rect in empty space', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(queryAll(tree, { minX: 400, minY: 400, maxX: 600, maxY: 600 })).toEqual([])
  })

  it('stops writing when the output buffer is full', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    const out = new Uint32Array(2)
    expect(tree.query(BOUNDS, out)).toBe(2)
  })

  it('hit-tests a point inside a box', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(tree.hitTest(50, 50)).toBe(0)
    expect(tree.hitTest(900, 900)).toBe(3)
  })

  it('returns -1 for a point in a gap', () => {
    const tree = buildQuadTree(quadrants(), BOUNDS)
    expect(tree.hitTest(500, 500)).toBe(-1)
    expect(tree.hitTest(-5, -5)).toBe(-1)
  })

  it('treats box edges as inclusive on the top-left, exclusive on the bottom-right', () => {
    const tree = buildQuadTree(Float64Array.from([100, 100, 50, 50]), BOUNDS)
    expect(tree.hitTest(100, 100)).toBe(0)
    expect(tree.hitTest(149.9, 149.9)).toBe(0)
    expect(tree.hitTest(150, 150)).toBe(-1)
  })

  it('returns the highest index when boxes overlap', () => {
    const tree = buildQuadTree(
      Float64Array.from([100, 100, 100, 100, 120, 120, 100, 100]),
      BOUNDS,
    )
    expect(tree.hitTest(150, 150)).toBe(1)
  })

  it('handles an empty layout', () => {
    const tree = buildQuadTree(new Float64Array(0), { minX: 0, minY: 0, maxX: 0, maxY: 0 })
    expect(tree.hitTest(0, 0)).toBe(-1)
    expect(queryAll(tree, BOUNDS)).toEqual([])
  })

  it('culls a 50k grid to a small window without scanning everything', () => {
    const count = 50_000
    const boxes = new Float64Array(count * 4)
    const perRow = 250
    for (let i = 0; i < count; i++) {
      boxes[i * 4] = (i % perRow) * 240
      boxes[i * 4 + 1] = Math.floor(i / perRow) * 120
      boxes[i * 4 + 2] = 220
      boxes[i * 4 + 3] = 96
    }
    const bounds = { minX: 0, minY: 0, maxX: perRow * 240, maxY: Math.ceil(count / perRow) * 120 }
    const tree = buildQuadTree(boxes, bounds)

    const out = new Uint32Array(count)
    const found = tree.query({ minX: 0, minY: 0, maxX: 1200, maxY: 600 }, out)
    // A 1200x600 window over a 240x120 grid covers at most 6x6 cells plus edges.
    expect(found).toBeGreaterThan(0)
    expect(found).toBeLessThan(100)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @klados/core test
```

Expected: FAIL — `Failed to resolve import "./quadtree.js"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/spatial/quadtree.ts`:

```ts
import type { Bounds } from '../types.js'

export interface QuadTree {
  /**
   * Writes the indices of every box overlapping `rect` into `out`.
   * Returns the number written; stops early when `out` is full.
   */
  query(rect: Bounds, out: Uint32Array): number
  /** Returns the index of the topmost box containing the point, or -1. */
  hitTest(x: number, y: number): number
}

interface Quad {
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Boxes that do not fit in any child quad. */
  items: number[]
  /** Child quads in NW, NE, SW, SE order; empty when this is a leaf. */
  children: Quad[]
}

const SPLIT_THRESHOLD = 8

function makeQuad(minX: number, minY: number, maxX: number, maxY: number): Quad {
  return { minX, minY, maxX, maxY, items: [], children: [] }
}

function split(quad: Quad): void {
  const midX = (quad.minX + quad.maxX) / 2
  const midY = (quad.minY + quad.maxY) / 2
  quad.children = [
    makeQuad(quad.minX, quad.minY, midX, midY),
    makeQuad(midX, quad.minY, quad.maxX, midY),
    makeQuad(quad.minX, midY, midX, quad.maxY),
    makeQuad(midX, midY, quad.maxX, quad.maxY),
  ]
}

/** Returns the child that fully contains the box, or -1. */
function childFor(quad: Quad, x0: number, y0: number, x1: number, y1: number): number {
  for (let c = 0; c < 4; c++) {
    const q = quad.children[c]!
    if (x0 >= q.minX && x1 <= q.maxX && y0 >= q.minY && y1 <= q.maxY) return c
  }
  return -1
}

/**
 * Builds a region quadtree over `boxes`, storing each box in the deepest quad
 * that fully contains it. `maxDepth` bounds memory for pathological layouts.
 */
export function buildQuadTree(boxes: Float64Array, bounds: Bounds, maxDepth = 12): QuadTree {
  const count = boxes.length / 4
  const root = makeQuad(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)

  for (let i = 0; i < count; i++) {
    const o = i * 4
    const x0 = boxes[o]!
    const y0 = boxes[o + 1]!
    const x1 = x0 + boxes[o + 2]!
    const y1 = y0 + boxes[o + 3]!

    let quad = root
    let depth = 0
    for (;;) {
      if (quad.children.length === 0) {
        if (quad.items.length < SPLIT_THRESHOLD || depth >= maxDepth) break
        split(quad)
        // Re-home the existing items now that children exist.
        const stay: number[] = []
        for (const item of quad.items) {
          const io = item * 4
          const c = childFor(
            quad,
            boxes[io]!,
            boxes[io + 1]!,
            boxes[io]! + boxes[io + 2]!,
            boxes[io + 1]! + boxes[io + 3]!,
          )
          if (c === -1) stay.push(item)
          else quad.children[c]!.items.push(item)
        }
        quad.items = stay
      }
      const c = childFor(quad, x0, y0, x1, y1)
      if (c === -1) break
      quad = quad.children[c]!
      depth++
    }
    quad.items.push(i)
  }

  const overlaps = (i: number, minX: number, minY: number, maxX: number, maxY: number): boolean => {
    const o = i * 4
    const x0 = boxes[o]!
    const y0 = boxes[o + 1]!
    return x0 < maxX && x0 + boxes[o + 2]! > minX && y0 < maxY && y0 + boxes[o + 3]! > minY
  }

  const contains = (i: number, x: number, y: number): boolean => {
    const o = i * 4
    const x0 = boxes[o]!
    const y0 = boxes[o + 1]!
    return x >= x0 && x < x0 + boxes[o + 2]! && y >= y0 && y < y0 + boxes[o + 3]!
  }

  // Reused across calls so neither query nor hitTest allocates per frame.
  const stack: Quad[] = []

  return {
    query(rect: Bounds, out: Uint32Array): number {
      let written = 0
      stack.length = 0
      stack.push(root)
      while (stack.length > 0) {
        const quad = stack.pop()!
        if (
          quad.minX >= rect.maxX ||
          quad.maxX <= rect.minX ||
          quad.minY >= rect.maxY ||
          quad.maxY <= rect.minY
        ) {
          continue
        }
        for (const item of quad.items) {
          if (!overlaps(item, rect.minX, rect.minY, rect.maxX, rect.maxY)) continue
          if (written >= out.length) return written
          out[written++] = item
        }
        for (const child of quad.children) stack.push(child)
      }
      return written
    },

    hitTest(x: number, y: number): number {
      let best = -1
      stack.length = 0
      stack.push(root)
      while (stack.length > 0) {
        const quad = stack.pop()!
        if (x < quad.minX || x >= quad.maxX || y < quad.minY || y >= quad.maxY) continue
        for (const item of quad.items) {
          if (item > best && contains(item, x, y)) best = item
        }
        for (const child of quad.children) stack.push(child)
      }
      return best
    },
  }
}
```

- [ ] **Step 4: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type { QuadTree } from './spatial/quadtree.js'
export { buildQuadTree } from './spatial/quadtree.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @klados/core test
pnpm typecheck
```

Expected: all `quadtree.test.ts` cases pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/spatial packages/core/src/index.ts
git commit -m "feat(core): region quadtree for viewport culling and hit-testing"
```

---

### Task 6: Viewport

Replaces the `panzoom` dependency. A camera is three numbers — `x`, `y`, `k` — and this module is the pure maths around them: coordinate conversion, anchored zoom, clamping, fit-to-bounds, and tween sampling.

No timers, no rAF, no event listeners. The caller drives time; this module only answers "where is the camera at progress `t`". That keeps it testable in Node and reusable from both the worker and the main thread.

**Files:**
- Create: `packages/core/src/viewport.ts`
- Create: `packages/core/src/viewport.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Bounds` from `types.ts`.
- Produces:
  - `interface Camera { x: number; y: number; k: number }`
  - `interface ViewportSize { width: number; height: number }`
  - `interface ZoomLimits { minK: number; maxK: number }`
  - `function worldToScreen(camera: Camera, wx: number, wy: number): { x: number; y: number }`
  - `function screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number }`
  - `function visibleRect(camera: Camera, size: ViewportSize): Bounds`
  - `function pan(camera: Camera, dx: number, dy: number): Camera`
  - `function zoomAt(camera: Camera, sx: number, sy: number, factor: number, limits: ZoomLimits): Camera`
  - `function fit(bounds: Bounds, size: ViewportSize, padding: number, limits: ZoomLimits): Camera`
  - `function centreOn(camera: Camera, bounds: Bounds, size: ViewportSize): Camera`
  - `function interpolate(from: Camera, to: Camera, t: number): Camera`
  - `function easeInOutCubic(t: number): number`

Screen position is `screen = world * k + offset`, so `camera.x`/`camera.y` are screen-space offsets, not world coordinates. Every function returns a new `Camera` rather than mutating — cameras are three numbers and treating them as values removes a whole class of aliasing bugs.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/viewport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  centreOn,
  easeInOutCubic,
  fit,
  interpolate,
  pan,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomAt,
} from './viewport.js'

const LIMITS = { minK: 0.1, maxK: 4 }
const SIZE = { width: 800, height: 600 }

describe('coordinate conversion', () => {
  it('maps world to screen with scale then offset', () => {
    expect(worldToScreen({ x: 50, y: 20, k: 2 }, 10, 5)).toEqual({ x: 70, y: 30 })
  })

  it('round-trips through screenToWorld', () => {
    const camera = { x: -120, y: 40, k: 1.75 }
    const screen = worldToScreen(camera, 333, 777)
    const world = screenToWorld(camera, screen.x, screen.y)
    expect(world.x).toBeCloseTo(333, 9)
    expect(world.y).toBeCloseTo(777, 9)
  })
})

describe('visibleRect', () => {
  it('returns the world rectangle currently on screen', () => {
    expect(visibleRect({ x: 0, y: 0, k: 2 }, SIZE)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 400,
      maxY: 300,
    })
  })

  it('accounts for a panned camera', () => {
    expect(visibleRect({ x: -200, y: -100, k: 1 }, SIZE)).toEqual({
      minX: 200,
      minY: 100,
      maxX: 1000,
      maxY: 700,
    })
  })
})

describe('pan', () => {
  it('shifts the offset in screen space and leaves zoom alone', () => {
    expect(pan({ x: 10, y: 10, k: 2 }, 5, -5)).toEqual({ x: 15, y: 5, k: 2 })
  })
})

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const before = { x: 0, y: 0, k: 1 }
    const world = screenToWorld(before, 300, 200)
    const after = zoomAt(before, 300, 200, 2, LIMITS)
    const screen = worldToScreen(after, world.x, world.y)
    expect(screen.x).toBeCloseTo(300, 9)
    expect(screen.y).toBeCloseTo(200, 9)
    expect(after.k).toBe(2)
  })

  it('clamps to maxK and stops moving once clamped', () => {
    const after = zoomAt({ x: 0, y: 0, k: 3 }, 400, 300, 10, LIMITS)
    expect(after.k).toBe(4)
  })

  it('clamps to minK', () => {
    const after = zoomAt({ x: 0, y: 0, k: 0.2 }, 400, 300, 0.01, LIMITS)
    expect(after.k).toBe(0.1)
  })

  it('is a no-op when already at the limit', () => {
    const at = { x: 33, y: 44, k: 4 }
    expect(zoomAt(at, 100, 100, 2, LIMITS)).toEqual(at)
  })
})

describe('fit', () => {
  it('scales content to the smaller axis and centres it', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, SIZE, 0, LIMITS)
    expect(camera.k).toBe(1.5) // 600 / 400 is the binding axis
    const topLeft = worldToScreen(camera, 0, 0)
    const bottomRight = worldToScreen(camera, 400, 400)
    expect(topLeft.y).toBeCloseTo(0, 9)
    expect(bottomRight.y).toBeCloseTo(600, 9)
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(400, 9)
  })

  it('honours padding', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, SIZE, 50, LIMITS)
    expect(camera.k).toBe(1.25) // (600 - 100) / 400
  })

  it('clamps the fit scale to maxK for tiny content', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, SIZE, 0, LIMITS)
    expect(camera.k).toBe(4)
  })

  it('returns an identity-ish camera for empty bounds', () => {
    const camera = fit({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, SIZE, 0, LIMITS)
    expect(camera.k).toBe(1)
    expect(camera.x).toBe(400)
    expect(camera.y).toBe(300)
  })
})

describe('centreOn', () => {
  it('centres the given bounds without changing zoom', () => {
    const camera = centreOn({ x: 0, y: 0, k: 2 }, { minX: 100, minY: 100, maxX: 200, maxY: 200 }, SIZE)
    expect(camera.k).toBe(2)
    const centre = worldToScreen(camera, 150, 150)
    expect(centre.x).toBeCloseTo(400, 9)
    expect(centre.y).toBeCloseTo(300, 9)
  })
})

describe('interpolate', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    const from = { x: 0, y: 0, k: 1 }
    const to = { x: 100, y: 50, k: 4 }
    expect(interpolate(from, to, 0)).toEqual(from)
    expect(interpolate(from, to, 1)).toEqual(to)
  })

  it('interpolates zoom geometrically so the rate feels constant', () => {
    const mid = interpolate({ x: 0, y: 0, k: 1 }, { x: 0, y: 0, k: 4 }, 0.5)
    expect(mid.k).toBeCloseTo(2, 9) // sqrt(1 * 4), not (1 + 4) / 2
  })

  it('clamps t outside 0..1', () => {
    const from = { x: 0, y: 0, k: 1 }
    const to = { x: 100, y: 0, k: 2 }
    expect(interpolate(from, to, -1)).toEqual(from)
    expect(interpolate(from, to, 5)).toEqual(to)
  })
})

describe('easeInOutCubic', () => {
  it('pins the endpoints and the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9)
  })

  it('is monotonic', () => {
    let prev = -1
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeInOutCubic(Math.min(t, 1))
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @klados/core test
```

Expected: FAIL — `Failed to resolve import "./viewport.js"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/viewport.ts`:

```ts
import type { Bounds } from './types.js'

/** screen = world * k + (x, y). x and y are screen-space offsets. */
export interface Camera {
  x: number
  y: number
  k: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface ZoomLimits {
  minK: number
  maxK: number
}

export function worldToScreen(camera: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * camera.k + camera.x, y: wy * camera.k + camera.y }
}

export function screenToWorld(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - camera.x) / camera.k, y: (sy - camera.y) / camera.k }
}

/** The world-space rectangle currently on screen — the culling query rect. */
export function visibleRect(camera: Camera, size: ViewportSize): Bounds {
  const topLeft = screenToWorld(camera, 0, 0)
  const bottomRight = screenToWorld(camera, size.width, size.height)
  return { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y }
}

export function pan(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x + dx, y: camera.y + dy, k: camera.k }
}

/**
 * Zooms by `factor` about a screen-space anchor, keeping the world point under
 * that anchor stationary. Returns the input unchanged when already clamped.
 */
export function zoomAt(
  camera: Camera,
  sx: number,
  sy: number,
  factor: number,
  limits: ZoomLimits,
): Camera {
  const k = Math.min(limits.maxK, Math.max(limits.minK, camera.k * factor))
  if (k === camera.k) return camera
  const world = screenToWorld(camera, sx, sy)
  return { x: sx - world.x * k, y: sy - world.y * k, k }
}

/** Scales `bounds` to fill `size` minus `padding` on every edge, then centres it. */
export function fit(
  bounds: Bounds,
  size: ViewportSize,
  padding: number,
  limits: ZoomLimits,
): Camera {
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  if (w <= 0 || h <= 0) {
    return { x: size.width / 2, y: size.height / 2, k: 1 }
  }
  const available = {
    width: Math.max(1, size.width - padding * 2),
    height: Math.max(1, size.height - padding * 2),
  }
  const raw = Math.min(available.width / w, available.height / h)
  const k = Math.min(limits.maxK, Math.max(limits.minK, raw))
  return centreOn({ x: 0, y: 0, k }, bounds, size)
}

/** Centres `bounds` in the viewport at the camera's current zoom. */
export function centreOn(camera: Camera, bounds: Bounds, size: ViewportSize): Camera {
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    x: size.width / 2 - cx * camera.k,
    y: size.height / 2 - cy * camera.k,
    k: camera.k,
  }
}

/**
 * Samples the camera between two states. Zoom is interpolated geometrically:
 * halfway between 1x and 4x is 2x, not 2.5x, which is what reads as a constant
 * zoom rate to the eye.
 */
export function interpolate(from: Camera, to: Camera, t: number): Camera {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t
  if (clamped === 0) return from
  if (clamped === 1) return to
  return {
    x: from.x + (to.x - from.x) * clamped,
    y: from.y + (to.y - from.y) * clamped,
    k: from.k * Math.pow(to.k / from.k, clamped),
  }
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
```

- [ ] **Step 4: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type { Camera, ViewportSize, ZoomLimits } from './viewport.js'
export {
  centreOn,
  easeInOutCubic,
  fit,
  interpolate,
  pan,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomAt,
} from './viewport.js'
```

- [ ] **Step 5: Run the full suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected: every test across `tree`, `tidy`, `orientation`, `quadtree`, and `viewport` passes; typecheck and lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/viewport.ts packages/core/src/viewport.test.ts packages/core/src/index.ts
git commit -m "feat(core): pan/zoom viewport maths, replacing the panzoom dependency"
```

---

## Done when

- `pnpm test`, `pnpm typecheck`, and `pnpm lint` all pass from the repo root.
- `packages/core` has zero entries under `dependencies`.
- Nothing under `packages/core/src` references `window`, `document`, or any Node built-in.
- The 50k layout budget test passes under 400ms.
- No module in `packages/core/src` recurses over tree nodes.

## Not in this plan

Deliberately deferred, each with its own plan:

- **Plan 2 — render pipeline, vanilla layer, and Vue adapter:** `render/renderer.ts`, `render/canvas2d.ts`, `text/measure.ts`, `worker/protocol.ts`, `worker/chart.worker.ts`, LOD tiers, the `packages/vanilla` DOM binding layer (`createKlados`, canvas creation, pointer input, worker bootstrap, overlay host), `Klados.vue` on top of it, the `KladosInstance` contract, tsdown builds, and vitest browser mode.
- **Plan 3 — features:** drag-drop reparenting, search and focus, SVG/PNG export, the hidden a11y tree, keyboard navigation, minimap, incremental dirty-subtree relayout, and `MIGRATION.md`.

Incremental relayout is Plan 3 rather than Plan 1 on purpose: the full layout must be correct and benchmarked before an incremental path has anything to be verified against.
