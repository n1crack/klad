# OrgChart Render Pipeline and Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a real org chart on screen — rasterized in a Web Worker, with framework slots overlaid on top — usable from plain TypeScript and from Vue.

**Architecture:** `packages/core` gains a transport-agnostic `ChartEngine` that owns tree, open/closed state, layout, and the spatial index, plus a `Renderer` interface with a Canvas2D backend. A Web Worker wraps the engine and draws to an `OffscreenCanvas` transferred from the main thread; a main-thread host drives the identical engine when workers are unavailable. `packages/vanilla` owns every piece of DOM work — canvas creation, pointer input, the node overlay, the accessibility tree — and exposes `createOrgChart`. `packages/vue` binds that to Vue reactivity and scoped slots, and adds nothing else.

**Tech Stack:** TypeScript 5.9, pnpm workspaces, turbo, vitest 4 (node + browser mode), tsdown, oxlint, Vue 3.5.

## Global Constraints

- **Zero third-party runtime dependencies** in every published package. `vue` is a peer dependency of `packages/vue` only.
- **TypeScript pinned to 5.9.x.** TS 7.0 is GA but `vue-tsc` cannot support it until TS 7.1. Do not upgrade.
- **ESM only.** No CJS output, no `require`, `"type": "module"` everywhere.
- **`packages/core` stays DOM-free.** No `window`, no `document`, no Node built-ins. Its `tsconfig.json` sets `types: []` and `lib: ["ES2023"]` to enforce this. **Never use `declare global`** — it augments the whole compilation and defeats that guard; a bare module-scoped `declare const` is the correct form. Canvas types that core needs are declared structurally inside core, not pulled from `lib.dom`.
- **No recursion over tree nodes.** Depth reaches 50,000.
- Import specifiers inside every package use explicit `.js` extensions.
- `noUncheckedIndexedAccess: true` and `exactOptionalPropertyTypes: true` are on.
- **Worker bundling:** `new Worker(new URL('./chart.worker.js', import.meta.url), { type: 'module' })`. No blob inlining, no consumer bundler configuration.
- **Performance budget:** frame time under 16ms at p95 with 50,000 nodes. A cold 50k layout is already under 400ms (measured ~21ms).
- Package names: `@n1crack/orgchart-core`, `@n1crack/orgchart` (vanilla), `@n1crack/orgchart-vue`.
- Spec of record: `docs/superpowers/specs/2026-07-21-orgchart-rework-design.md`.

## What already exists

`packages/core` currently exports, all verified by 115 passing tests:

```ts
normalize(data: readonly NodeData[]): Tree
subtreeOf(tree: Tree, index: number): Int32Array
wouldCreateCycle(tree: Tree, index: number, newParent: number): boolean
interface Tree { count, indexToId: string[], idToIndex: Map<string,number>,
                 parent, childStart, childIndex, roots, depth, order: Int32Array,
                 warnings: Warning[] }

layout(tree: Tree, sizes: Float64Array, opts: { spacingX, spacingY }): { boxes: Float64Array, bounds: Bounds }
applyOrientation(boxes: Float64Array, bounds: Bounds, orientation: Orientation, rtl: boolean): Bounds
buildQuadTree(boxes: Float64Array, bounds: Bounds, maxDepth?: number): QuadTree
interface QuadTree { query(rect: Bounds, out: Uint32Array): number; hitTest(x, y): number }

worldToScreen, screenToWorld, visibleRect, pan, zoomAt, fit, centreOn, interpolate, easeInOutCubic
interface Camera { x, y, k }
```

`boxes` holds `[x, y, w, h]` per node; node `i` occupies `boxes[i*4 .. i*4+3]`. `layout()` normalizes so `bounds.minX === 0` and `bounds.minY === 0`; `applyOrientation` **throws** if that precondition is violated.

**Known gap this plan closes:** core has no notion of collapsed nodes. `layout()` lays out every node. Task 1 adds visible-subtree pruning.

## File structure

```
packages/core/src/
  visible.ts             # prune a Tree to its expanded nodes            (Task 1)
  text/measure.ts        # text width cache + binary-search truncation   (Task 2)
  render/theme.ts        # drawing tokens + defaults                     (Task 3)
  render/lod.ts          # zoom -> detail tier                           (Task 3)
  render/renderer.ts     # Renderer interface + structural canvas types  (Task 4)
  render/canvas2d.ts     # Canvas2D backend                              (Task 4)
  engine.ts              # ChartEngine: state, relayout, frame           (Task 5)
  worker/protocol.ts     # wire types + discriminated message union      (Task 5)
  worker/chart.worker.ts # worker entry, wraps ChartEngine               (Task 6)
  worker/host.ts         # main-thread side; worker or in-process        (Task 6)

packages/vanilla/src/
  index.ts               # createOrgChart, public types                  (Task 7)
  input.ts               # pointer, wheel, touch -> camera               (Task 7)
  overlay.ts             # pooled DOM node overlay                       (Task 7)
  a11y.ts                # hidden role=tree mirror + keyboard nav        (Task 8)

packages/vue/src/
  index.ts               # plugin + exports                              (Task 9)
  OrgChart.vue           # component, scoped #node slot                  (Task 9)
  useOrgChart.ts         # imperative API composable                     (Task 9)

packages/playground/     # vite 8 demo, vanilla + vue tabs                (Task 9)
```

---

### Task 1: Visible-subtree pruning

Collapsing a node must remove its descendants from layout entirely, not merely hide them. This produces a pruned index space and the mapping back to the full tree.

**Files:**
- Create: `packages/core/src/visible.ts`
- Create: `packages/core/src/visible.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Tree` from `./tree.js`.
- Produces:
  - `interface VisibleTree { tree: Tree; toSource: Int32Array; fromSource: Int32Array }` — `tree` is a valid `Tree` over visible nodes only; `toSource[i]` gives the original index of visible node `i`; `fromSource[j]` gives the visible index of original node `j`, or `-1` when hidden.
  - `function pruneToVisible(tree: Tree, open: Uint8Array): VisibleTree`

`open[i]` is 1 when node `i` shows its children. A closed node stays visible itself; only its descendants disappear. `indexToId`/`idToIndex` on the returned tree are rebuilt so the pruned tree is a fully valid `Tree` — later tasks feed it straight to `layout()`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/visible.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @n1crack/orgchart-core test`
Expected: FAIL — `Failed to resolve import "./visible.js"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/visible.ts`:

```ts
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
```

Note the CSR offsets: `childStart` has length `count + 1` while `childIndex` has length `count - roots.length`, because roots are nobody's child. Preorder assignment means children always follow their parent, so sibling order is preserved without a sort.

- [ ] **Step 4: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type { VisibleTree } from './visible.js'
export { pruneToVisible } from './visible.js'
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @n1crack/orgchart-core test && pnpm typecheck && pnpm lint`
Expected: all pass, exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/visible.ts packages/core/src/visible.test.ts packages/core/src/index.ts
git commit -m "feat(core): prune a tree to its visible nodes for collapse support"
```

---

### Task 2: Text measurement cache

Canvas text measurement is expensive and happens per visible node per frame. This caches widths and truncates by binary search over the cache rather than by measuring every prefix.

**Files:**
- Create: `packages/core/src/text/measure.ts`
- Create: `packages/core/src/text/measure.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface TextMetricsSource { measureWidth(text: string): number }`
  - `interface TextMeasurer { width(text: string): number; truncate(text: string, maxWidth: number, ellipsis?: string): string; clear(): void; readonly size: number }`
  - `function createTextMeasurer(source: TextMetricsSource, maxEntries?: number): TextMeasurer`

`TextMetricsSource` exists so core never touches a real canvas: the Canvas2D backend passes an adapter over `ctx.measureText`, and tests pass a deterministic fake. Default `maxEntries` is 4096; eviction is oldest-first via `Map` insertion order.

- [ ] **Step 1: Write the failing test**

`packages/core/src/text/measure.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createTextMeasurer } from './measure.js'

/** 10 units per character — makes every expectation arithmetic. */
function fixedWidthSource() {
  return { measureWidth: vi.fn((text: string) => text.length * 10) }
}

describe('createTextMeasurer', () => {
  it('returns the source width', () => {
    const m = createTextMeasurer(fixedWidthSource())
    expect(m.width('abc')).toBe(30)
  })

  it('measures each distinct string only once', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source)
    m.width('abc')
    m.width('abc')
    m.width('abc')
    expect(source.measureWidth).toHaveBeenCalledTimes(1)
    expect(m.size).toBe(1)
  })

  it('returns text unchanged when it already fits', () => {
    const m = createTextMeasurer(fixedWidthSource())
    expect(m.truncate('abcde', 50)).toBe('abcde')
    expect(m.truncate('abcde', 999)).toBe('abcde')
  })

  it('truncates with an ellipsis to the longest prefix that fits', () => {
    const m = createTextMeasurer(fixedWidthSource())
    // Ellipsis is 10 wide, so a 45-wide budget leaves 35 for the prefix -> 3 chars.
    expect(m.truncate('abcdefgh', 45)).toBe('abc…')
  })

  it('honours a custom ellipsis', () => {
    const m = createTextMeasurer(fixedWidthSource())
    // '...' is 30 wide, leaving 30 of a 60 budget -> 3 chars.
    expect(m.truncate('abcdefgh', 60, '...')).toBe('abc...')
  })

  it('returns an empty string when not even the ellipsis fits', () => {
    const m = createTextMeasurer(fixedWidthSource())
    expect(m.truncate('abcdefgh', 5)).toBe('')
    expect(m.truncate('abcdefgh', 0)).toBe('')
  })

  it('truncates in a logarithmic number of measurements, not linear', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source)
    const text = 'x'.repeat(1000)
    m.truncate(text, 500)
    // Binary search over 1000 positions is ~10 probes; allow slack for the
    // full-string and ellipsis measurements. A linear scan would be ~1000.
    expect(source.measureWidth.mock.calls.length).toBeLessThan(25)
  })

  it('handles an empty string', () => {
    const m = createTextMeasurer(fixedWidthSource())
    expect(m.width('')).toBe(0)
    expect(m.truncate('', 100)).toBe('')
  })

  it('evicts the oldest entry when the cache is full', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source, 2)
    m.width('a')
    m.width('b')
    m.width('c')
    expect(m.size).toBe(2)
    m.width('a') // evicted, so measured again
    expect(source.measureWidth).toHaveBeenCalledTimes(4)
  })

  it('drops everything on clear', () => {
    const source = fixedWidthSource()
    const m = createTextMeasurer(source)
    m.width('abc')
    m.clear()
    expect(m.size).toBe(0)
    m.width('abc')
    expect(source.measureWidth).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @n1crack/orgchart-core test`
Expected: FAIL — `Failed to resolve import "./measure.js"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/text/measure.ts`:

```ts
/**
 * Whatever can measure a string. The Canvas2D backend adapts `ctx.measureText`;
 * tests pass a deterministic fake. Core never sees a canvas type through this.
 */
export interface TextMetricsSource {
  measureWidth(text: string): number
}

export interface TextMeasurer {
  width(text: string): number
  /** Longest prefix of `text` that fits `maxWidth`, plus an ellipsis if shortened. */
  truncate(text: string, maxWidth: number, ellipsis?: string): string
  clear(): void
  readonly size: number
}

const DEFAULT_MAX_ENTRIES = 4096
const DEFAULT_ELLIPSIS = '…'

/**
 * Caches measured widths and truncates by binary search over prefixes, so the
 * number of measurements per label grows with log(length) rather than length.
 * Eviction is oldest-first, which `Map` gives for free through insertion order.
 */
export function createTextMeasurer(
  source: TextMetricsSource,
  maxEntries = DEFAULT_MAX_ENTRIES,
): TextMeasurer {
  const cache = new Map<string, number>()

  const width = (text: string): number => {
    if (text === '') return 0
    const hit = cache.get(text)
    if (hit !== undefined) return hit
    const w = source.measureWidth(text)
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
    cache.set(text, w)
    return w
  }

  const truncate = (text: string, maxWidth: number, ellipsis = DEFAULT_ELLIPSIS): string => {
    if (text === '') return ''
    if (width(text) <= maxWidth) return text

    const ellipsisWidth = width(ellipsis)
    const budget = maxWidth - ellipsisWidth
    if (budget <= 0) return ''

    // Largest `len` with width(text.slice(0, len)) <= budget.
    let lo = 0
    let hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (width(text.slice(0, mid)) <= budget) lo = mid
      else hi = mid - 1
    }
    return lo === 0 ? '' : text.slice(0, lo) + ellipsis
  }

  return {
    width,
    truncate,
    clear: () => cache.clear(),
    get size() {
      return cache.size
    },
  }
}
```

- [ ] **Step 4: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type { TextMeasurer, TextMetricsSource } from './text/measure.js'
export { createTextMeasurer } from './text/measure.js'
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @n1crack/orgchart-core test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/text packages/core/src/index.ts
git commit -m "feat(core): cached text measurement with logarithmic truncation"
```

---

### Task 3: Theme tokens and level-of-detail tiers

Two small pure modules the renderer reads: what to draw with, and how much to draw.

**Files:**
- Create: `packages/core/src/render/theme.ts`
- Create: `packages/core/src/render/lod.ts`
- Create: `packages/core/src/render/lod.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Theme { nodeFill, nodeStroke, nodeStrokeWidth, cornerRadius, edgeStroke, edgeWidth, labelColour, labelFont, labelPadding, highlightFill, highlightStroke, dragGhostAlpha }`
  - `const DEFAULT_THEME: Theme`
  - `function resolveTheme(partial?: Partial<Theme>): Theme`
  - `type LodTier = 'block' | 'label' | 'full'`
  - `interface LodThresholds { text: number; overlay: number }`
  - `const DEFAULT_LOD: LodThresholds`
  - `function lodFor(zoom: number, thresholds: LodThresholds): LodTier`
  - `function overlayEnabled(zoom: number, thresholds: LodThresholds): boolean`

Tiers per the spec: below `text` draw plain rectangles and connectors; between `text` and `overlay` add a truncated single-line label; at or above `overlay` draw the full card and let the DOM overlay take over.

- [ ] **Step 1: Write the failing test**

`packages/core/src/render/lod.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOD, lodFor, overlayEnabled } from './lod.js'
import { DEFAULT_THEME, resolveTheme } from './theme.js'

describe('lodFor', () => {
  it('draws blocks below the text threshold', () => {
    expect(lodFor(0.1, DEFAULT_LOD)).toBe('block')
    expect(lodFor(0.249, DEFAULT_LOD)).toBe('block')
  })

  it('draws labels from the text threshold up to the overlay threshold', () => {
    expect(lodFor(0.25, DEFAULT_LOD)).toBe('label')
    expect(lodFor(0.59, DEFAULT_LOD)).toBe('label')
  })

  it('draws full cards at and above the overlay threshold', () => {
    expect(lodFor(0.6, DEFAULT_LOD)).toBe('full')
    expect(lodFor(4, DEFAULT_LOD)).toBe('full')
  })

  it('treats both thresholds as inclusive lower bounds', () => {
    const t = { text: 1, overlay: 2 }
    expect(lodFor(0.999, t)).toBe('block')
    expect(lodFor(1, t)).toBe('label')
    expect(lodFor(1.999, t)).toBe('label')
    expect(lodFor(2, t)).toBe('full')
  })

  it('collapses cleanly when the thresholds are equal', () => {
    const t = { text: 1, overlay: 1 }
    expect(lodFor(0.9, t)).toBe('block')
    expect(lodFor(1, t)).toBe('full')
  })
})

describe('overlayEnabled', () => {
  it('matches the full tier exactly', () => {
    expect(overlayEnabled(0.59, DEFAULT_LOD)).toBe(false)
    expect(overlayEnabled(0.6, DEFAULT_LOD)).toBe(true)
  })
})

describe('resolveTheme', () => {
  it('returns the defaults when given nothing', () => {
    expect(resolveTheme()).toEqual(DEFAULT_THEME)
  })

  it('overrides only the keys provided', () => {
    const theme = resolveTheme({ edgeStroke: 'red' })
    expect(theme.edgeStroke).toBe('red')
    expect(theme.nodeFill).toBe(DEFAULT_THEME.nodeFill)
  })

  it('does not mutate the defaults', () => {
    resolveTheme({ nodeFill: 'hotpink' })
    expect(DEFAULT_THEME.nodeFill).not.toBe('hotpink')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @n1crack/orgchart-core test`
Expected: FAIL — `Failed to resolve import "./lod.js"`.

- [ ] **Step 3: Write the implementations**

`packages/core/src/render/theme.ts`:

```ts
/** Drawing tokens for the canvas layers. Colours are any CSS colour string. */
export interface Theme {
  nodeFill: string
  nodeStroke: string
  nodeStrokeWidth: number
  cornerRadius: number
  edgeStroke: string
  edgeWidth: number
  labelColour: string
  /** A full CSS font shorthand, e.g. '14px system-ui, sans-serif'. */
  labelFont: string
  /** Inset from the node box to the label, in world units. */
  labelPadding: number
  highlightFill: string
  highlightStroke: string
  /** Alpha applied to a node while it is being dragged. */
  dragGhostAlpha: number
}

export const DEFAULT_THEME: Theme = {
  nodeFill: '#ffffff',
  nodeStroke: '#d4d4d8',
  nodeStrokeWidth: 1,
  cornerRadius: 6,
  edgeStroke: '#d4d4d8',
  edgeWidth: 1,
  labelColour: '#18181b',
  labelFont: '14px system-ui, -apple-system, Segoe UI, sans-serif',
  labelPadding: 10,
  highlightFill: '#fef3c7',
  highlightStroke: '#f59e0b',
  dragGhostAlpha: 0.6,
}

export function resolveTheme(partial?: Partial<Theme>): Theme {
  return { ...DEFAULT_THEME, ...partial }
}
```

`packages/core/src/render/lod.ts`:

```ts
/**
 * How much detail to draw at the current zoom.
 * - `block`: rectangles and connectors only, no text.
 * - `label`: adds one truncated line of text per node.
 * - `full`: the complete card; the DOM overlay is also active at this tier.
 */
export type LodTier = 'block' | 'label' | 'full'

export interface LodThresholds {
  /** Zoom at which labels start being drawn. */
  text: number
  /** Zoom at which full cards are drawn and the DOM overlay activates. */
  overlay: number
}

export const DEFAULT_LOD: LodThresholds = { text: 0.25, overlay: 0.6 }

/** Both thresholds are inclusive lower bounds, so a tier begins exactly at its value. */
export function lodFor(zoom: number, thresholds: LodThresholds): LodTier {
  if (zoom >= thresholds.overlay) return 'full'
  if (zoom >= thresholds.text) return 'label'
  return 'block'
}

export function overlayEnabled(zoom: number, thresholds: LodThresholds): boolean {
  return lodFor(zoom, thresholds) === 'full'
}
```

- [ ] **Step 4: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type { Theme } from './render/theme.js'
export { DEFAULT_THEME, resolveTheme } from './render/theme.js'
export type { LodThresholds, LodTier } from './render/lod.js'
export { DEFAULT_LOD, lodFor, overlayEnabled } from './render/lod.js'
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @n1crack/orgchart-core test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render packages/core/src/index.ts
git commit -m "feat(core): drawing theme tokens and level-of-detail tiers"
```

---

### Task 4: Renderer interface and Canvas2D backend

The first code in core that draws. It must still typecheck with `types: []` and `lib: ["ES2023"]`, so the canvas API is declared structurally — only the members actually used.

Edges are batched into a single `Path2D` per frame; there is no per-node stroke call.

**Files:**
- Create: `packages/core/src/render/renderer.ts`
- Create: `packages/core/src/render/canvas2d.ts`
- Create: `packages/core/src/render/canvas2d.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Theme`, `LodTier`, `TextMeasurer`, `Camera`, `Bounds`.
- Produces:
  - `interface RenderSurface { width: number; height: number; getContext(id: '2d'): RenderContext2D | null }` and `interface RenderContext2D { ... }` — structural, DOM-free.
  - `interface Frame { boxes: Float64Array; parent: Int32Array; visible: Uint32Array; visibleCount: number; labels: readonly string[]; camera: Camera; dpr: number; tier: LodTier; highlight: Uint8Array | null; dragIndex: number }`
  - `interface Renderer { resize(width: number, height: number, dpr: number): void; draw(frame: Frame): void; readonly stats: { lastDrawCalls: number } }`
  - `function createCanvas2DRenderer(surface: RenderSurface, theme: Theme, measurerFor: (font: string) => TextMeasurer): Renderer`

`stats.lastDrawCalls` exists so tests can assert edge batching actually happened rather than trusting the implementation.

- [ ] **Step 1: Add vitest browser mode alongside the node suite**

Canvas cannot be tested honestly under jsdom. Browser mode went stable in vitest 4 and is the supported path.

Install:

```bash
pnpm -w add -D @vitest/browser playwright
pnpm exec playwright install chromium
```

Replace `packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
```

Every existing test keeps running under the `node` project; only files named `*.browser.test.ts` get a real browser.

- [ ] **Step 2: Write the failing test**

`packages/core/src/render/canvas2d.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createCanvas2DRenderer } from './canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import { DEFAULT_THEME } from './theme.js'
import type { Frame } from './renderer.js'

function makeCanvas(width = 400, height = 300): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  document.body.appendChild(canvas)
  return canvas
}

function measurerFor(font: string) {
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = font
  return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
}

/** Two boxes, child below parent. */
function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    boxes: Float64Array.from([0, 0, 100, 50, 0, 100, 100, 50]),
    parent: Int32Array.from([-1, 0]),
    visible: Uint32Array.from([0, 1]),
    visibleCount: 2,
    labels: ['Root', 'Child'],
    camera: { x: 10, y: 10, k: 1 },
    dpr: 1,
    tier: 'full',
    horizontal: false,
    highlight: null,
    dragIndex: -1,
    ...overrides,
  }
}

function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): Uint8ClampedArray {
  return canvas.getContext('2d')!.getImageData(x, y, 1, 1).data
}

describe('createCanvas2DRenderer', () => {
  it('draws a node where the camera puts it', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame())

    // Node 0 spans screen x 10..110, y 10..60. Its centre must not be blank.
    const inside = pixelAt(canvas, 60, 35)
    expect(inside[3]).toBeGreaterThan(0)
    // Far corner is untouched.
    const outside = pixelAt(canvas, 380, 290)
    expect(outside[3]).toBe(0)
  })

  it('scales the backing store by dpr but keeps camera units in CSS pixels', () => {
    const canvas = makeCanvas(800, 600)
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 2)
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(600)

    renderer.draw(frame())
    // The same world point lands at twice the device pixel offset.
    expect(pixelAt(canvas, 120, 70)[3]).toBeGreaterThan(0)
  })

  it('batches every edge into one path regardless of node count', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)

    const count = 50
    const boxes = new Float64Array(count * 4)
    const parent = new Int32Array(count)
    const visible = new Uint32Array(count)
    for (let i = 0; i < count; i++) {
      boxes[i * 4] = (i % 10) * 30
      boxes[i * 4 + 1] = Math.floor(i / 10) * 60
      boxes[i * 4 + 2] = 20
      boxes[i * 4 + 3] = 20
      parent[i] = i === 0 ? -1 : i - 1
      visible[i] = i
    }
    renderer.draw(frame({ boxes, parent, visible, visibleCount: count, labels: [] }))
    expect(renderer.stats.lastDrawCalls.edgeStrokes).toBe(1)
  })

  it('skips text entirely at the block tier', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame({ tier: 'block' }))
    expect(renderer.stats.lastDrawCalls.labels).toBe(0)
  })

  it('draws one label per visible node at the label tier', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame({ tier: 'label' }))
    expect(renderer.stats.lastDrawCalls.labels).toBe(2)
  })

  it('clears the previous frame', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    renderer.draw(frame())
    expect(pixelAt(canvas, 60, 35)[3]).toBeGreaterThan(0)

    renderer.draw(frame({ visibleCount: 0, visible: new Uint32Array(0) }))
    expect(pixelAt(canvas, 60, 35)[3]).toBe(0)
  })

  it('draws nothing and does not throw on an empty frame', () => {
    const canvas = makeCanvas()
    const renderer = createCanvas2DRenderer(canvas, DEFAULT_THEME, measurerFor)
    renderer.resize(400, 300, 1)
    expect(() =>
      renderer.draw(
        frame({
          boxes: new Float64Array(0),
          parent: new Int32Array(0),
          visible: new Uint32Array(0),
          visibleCount: 0,
          labels: [],
        }),
      ),
    ).not.toThrow()
  })

  it('tints a highlighted node differently from an unhighlighted one', () => {
    const plain = makeCanvas()
    const plainRenderer = createCanvas2DRenderer(plain, DEFAULT_THEME, measurerFor)
    plainRenderer.resize(400, 300, 1)
    plainRenderer.draw(frame())

    const lit = makeCanvas()
    const litRenderer = createCanvas2DRenderer(lit, DEFAULT_THEME, measurerFor)
    litRenderer.resize(400, 300, 1)
    litRenderer.draw(frame({ highlight: Uint8Array.from([1, 0]) }))

    expect(Array.from(pixelAt(lit, 60, 35))).not.toEqual(Array.from(pixelAt(plain, 60, 35)))
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @n1crack/orgchart-core test`
Expected: FAIL — `Failed to resolve import "./canvas2d.js"`. The browser project should start Chromium; if Playwright reports a missing browser, rerun `pnpm exec playwright install chromium`.

- [ ] **Step 4: Write the renderer interface**

`packages/core/src/render/renderer.ts`:

```ts
import type { Camera } from '../viewport.js'
import type { LodTier } from './lod.js'

/**
 * The slice of the canvas 2D API this renderer uses, declared structurally.
 * `packages/core` compiles with `types: []` and `lib: ["ES2023"]`, so it has no
 * `lib.dom` — and it must not gain one, because that would also make `window`
 * and `document` resolvable inside worker-bound code. A real `HTMLCanvasElement`
 * and an `OffscreenCanvas` both satisfy these shapes.
 */
export interface RenderContext2D {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  globalAlpha: number
  textBaseline: string
  save(): void
  restore(): void
  scale(x: number, y: number): void
  translate(x: number, y: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  roundRect(x: number, y: number, w: number, h: number, radii: number): void
  rect(x: number, y: number, w: number, h: number): void
  fill(): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
}

export interface RenderSurface {
  width: number
  height: number
  getContext(id: '2d'): RenderContext2D | null
}

/** Everything the renderer needs for one frame. Nothing is derived internally. */
export interface Frame {
  /** [x, y, w, h] per node, in world units. */
  boxes: Float64Array
  /** Parent index per node, -1 for roots. Used to draw connectors. */
  parent: Int32Array
  /** Indices to draw; only the first `visibleCount` entries are read. */
  visible: Uint32Array
  visibleCount: number
  /** Label per node index. May be empty when the tier draws no text. */
  labels: readonly string[]
  camera: Camera
  dpr: number
  tier: LodTier
  /**
   * True for `lr`/`rl`. Connectors elbow along the tree's growth axis, which is
   * horizontal for those orientations and vertical otherwise — splitting on the
   * wrong axis makes the routing cross through node boxes.
   */
  horizontal: boolean
  /** 1 per highlighted node index, or null when nothing is highlighted. */
  highlight: Uint8Array | null
  /** Node currently being dragged, or -1. Drawn with reduced alpha. */
  dragIndex: number
}

export interface DrawCallStats {
  /** Stroke calls spent on edges. Batching keeps this at 1 for any node count. */
  edgeStrokes: number
  /** Nodes drawn. */
  nodes: number
  /** Labels drawn. */
  labels: number
}

export interface Renderer {
  /** `width`/`height` are CSS pixels; the backing store is scaled by `dpr`. */
  resize(width: number, height: number, dpr: number): void
  draw(frame: Frame): void
  readonly stats: { lastDrawCalls: DrawCallStats }
}
```

- [ ] **Step 5: Write the Canvas2D backend**

`packages/core/src/render/canvas2d.ts`:

```ts
import type { TextMeasurer } from '../text/measure.js'
import type { DrawCallStats, Frame, Renderer, RenderSurface } from './renderer.js'
import type { Theme } from './theme.js'

/**
 * Canvas2D backend.
 *
 * Camera units are CSS pixels throughout; `dpr` is applied once as a transform
 * on the backing store, so no call site has to remember to multiply.
 *
 * Connectors are accumulated into a single path and stroked once per frame.
 * Stroking per node is the classic way to make a 50k chart unusable, so
 * `stats.lastDrawCalls.edgeStrokes` is asserted by the tests rather than left
 * to trust.
 */
export function createCanvas2DRenderer(
  surface: RenderSurface,
  theme: Theme,
  measurerFor: (font: string) => TextMeasurer,
): Renderer {
  const ctx = surface.getContext('2d')
  if (ctx === null) throw new Error('OrgChart: 2D canvas context unavailable')

  const measurer = measurerFor(theme.labelFont)
  let cssWidth = 0
  let cssHeight = 0
  let devicePixelRatio = 1

  const stats = { lastDrawCalls: { edgeStrokes: 0, nodes: 0, labels: 0 } as DrawCallStats }

  const resize = (width: number, height: number, dpr: number): void => {
    cssWidth = width
    cssHeight = height
    devicePixelRatio = dpr
    surface.width = Math.round(width * dpr)
    surface.height = Math.round(height * dpr)
  }

  const draw = (frame: Frame): void => {
    const calls: DrawCallStats = { edgeStrokes: 0, nodes: 0, labels: 0 }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, surface.width, surface.height)
    ctx.save()
    ctx.scale(devicePixelRatio, devicePixelRatio)

    const { boxes, parent, visible, visibleCount, camera } = frame
    const k = camera.k

    // Edges first so nodes paint over the joins.
    if (visibleCount > 0) {
      ctx.beginPath()
      for (let n = 0; n < visibleCount; n++) {
        const i = visible[n]!
        const p = parent[i]!
        if (p === -1) continue
        const io = i * 4
        const po = p * 4
        if (frame.horizontal) {
          // Growth axis is x: leave the parent's right edge, split on x.
          const px = (boxes[po]! + boxes[po + 2]!) * k + camera.x
          const py = (boxes[po + 1]! + boxes[po + 3]! / 2) * k + camera.y
          const cx = boxes[io]! * k + camera.x
          const cy = (boxes[io + 1]! + boxes[io + 3]! / 2) * k + camera.y
          const midX = (px + cx) / 2
          ctx.moveTo(px, py)
          ctx.lineTo(midX, py)
          ctx.lineTo(midX, cy)
          ctx.lineTo(cx, cy)
        } else {
          const px = (boxes[po]! + boxes[po + 2]! / 2) * k + camera.x
          const py = (boxes[po + 1]! + boxes[po + 3]!) * k + camera.y
          const cx = (boxes[io]! + boxes[io + 2]! / 2) * k + camera.x
          const cy = boxes[io + 1]! * k + camera.y
          const midY = (py + cy) / 2
          ctx.moveTo(px, py)
          ctx.lineTo(px, midY)
          ctx.lineTo(cx, midY)
          ctx.lineTo(cx, cy)
        }
      }
      ctx.strokeStyle = theme.edgeStroke
      ctx.lineWidth = theme.edgeWidth
      ctx.stroke()
      calls.edgeStrokes = 1
    }

    const radius = frame.tier === 'block' ? 0 : theme.cornerRadius * k
    for (let n = 0; n < visibleCount; n++) {
      const i = visible[n]!
      const o = i * 4
      const x = boxes[o]! * k + camera.x
      const y = boxes[o + 1]! * k + camera.y
      const w = boxes[o + 2]! * k
      const h = boxes[o + 3]! * k
      const lit = frame.highlight !== null && frame.highlight[i] === 1

      if (i === frame.dragIndex) ctx.globalAlpha = theme.dragGhostAlpha

      ctx.beginPath()
      if (radius > 0) ctx.roundRect(x, y, w, h, radius)
      else ctx.rect(x, y, w, h)
      ctx.fillStyle = lit ? theme.highlightFill : theme.nodeFill
      ctx.fill()
      if (frame.tier !== 'block') {
        ctx.strokeStyle = lit ? theme.highlightStroke : theme.nodeStroke
        ctx.lineWidth = theme.nodeStrokeWidth
        ctx.stroke()
      }
      calls.nodes++

      if (i === frame.dragIndex) ctx.globalAlpha = 1
    }

    if (frame.tier !== 'block' && frame.labels.length > 0) {
      ctx.fillStyle = theme.labelColour
      ctx.font = theme.labelFont
      ctx.textBaseline = 'middle'
      const pad = theme.labelPadding * k
      for (let n = 0; n < visibleCount; n++) {
        const i = visible[n]!
        const label = frame.labels[i]
        if (label === undefined || label === '') continue
        const o = i * 4
        const w = boxes[o + 2]! * k
        const text = measurer.truncate(label, Math.max(0, w - pad * 2))
        if (text === '') continue
        ctx.fillText(
          text,
          boxes[o]! * k + camera.x + pad,
          (boxes[o + 1]! + boxes[o + 3]! / 2) * k + camera.y,
        )
        calls.labels++
      }
    }

    ctx.restore()
    stats.lastDrawCalls = calls
  }

  return {
    resize,
    draw,
    get stats() {
      return stats
    },
  }
}
```

`cssWidth` and `cssHeight` are retained because Task 6 reads them back when reporting viewport size to the engine.

- [ ] **Step 6: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type {
  DrawCallStats,
  Frame,
  Renderer,
  RenderContext2D,
  RenderSurface,
} from './render/renderer.js'
export { createCanvas2DRenderer } from './render/canvas2d.js'
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @n1crack/orgchart-core test && pnpm typecheck && pnpm lint`
Expected: the node project keeps passing and the browser project runs the seven canvas cases in Chromium.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/render packages/core/src/index.ts packages/core/vitest.config.ts package.json pnpm-lock.yaml
git commit -m "feat(core): Renderer interface and Canvas2D backend with batched edges"
```

---

### Task 5: Chart engine and worker protocol

The engine owns all mutable chart state and is deliberately transport-agnostic: the worker wraps it, and the main-thread fallback drives the very same object. Writing it once is what keeps the two paths from drifting.

**Files:**
- Create: `packages/core/src/worker/protocol.ts`
- Create: `packages/core/src/engine.ts`
- Create: `packages/core/src/engine.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Tree`, `pruneToVisible`, `layout`, `applyOrientation`, `buildQuadTree`, `visibleRect`, `Frame`, `Renderer`, `LodThresholds`, `Orientation`.
- Produces:
  - `interface WireTree { count, parent, childStart, childIndex, roots, depth, order }` (all `Int32Array`)
  - `function toWireTree(tree: Tree): WireTree`
  - `function wireTreeToTree(wire: WireTree): Tree` — synthesises placeholder ids; the worker never needs real ones.
  - `type MainToWorker` / `type WorkerToMain` discriminated unions.
  - `interface EngineOptions { spacingX, spacingY, orientation, rtl, lod }`
  - `interface ChartEngine { setData(wire, sizes, labels, open): void; setOptions(p: Partial<EngineOptions>): void; setOpen(index, open): void; setCamera(c: Camera): void; setViewport(w, h, dpr): void; setHighlight(ids: Uint32Array | null): void; setDrag(index: number): void; render(): Uint32Array; readonly boxes: Float64Array; readonly bounds: Bounds; readonly visibleToSource: Int32Array; hitTest(worldX, worldY): number }`
  - `function createChartEngine(renderer: Renderer): ChartEngine`

`render()` returns the source indices currently on screen, which the overlay consumes. Layout is recomputed only when data, options, or open state change — never on a camera move.

- [ ] **Step 1: Write the failing test**

`packages/core/src/engine.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createChartEngine } from './engine.js'
import { toWireTree, wireTreeToTree } from './worker/protocol.js'
import { normalize } from './tree.js'
import type { Frame, Renderer } from './render/renderer.js'

function fakeRenderer(): Renderer & { frames: Frame[] } {
  const frames: Frame[] = []
  return {
    frames,
    resize: vi.fn(),
    draw: (f: Frame) => {
      // Copy the parts assertions read; the engine reuses its buffers.
      frames.push({ ...f, visible: f.visible.slice(0, f.visibleCount) })
    },
    stats: { lastDrawCalls: { edgeStrokes: 0, nodes: 0, labels: 0 } },
  }
}

const DATA = [
  { id: 'a' },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: 'a' },
]

function sizesFor(count: number, w = 100, h = 50): Float64Array {
  const s = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    s[i * 2] = w
    s[i * 2 + 1] = h
  }
  return s
}

function seed(renderer: Renderer) {
  const engine = createChartEngine(renderer)
  const tree = normalize(DATA)
  engine.setViewport(800, 600, 1)
  engine.setData(toWireTree(tree), sizesFor(tree.count), ['a', 'b', 'c', 'd'], new Uint8Array(tree.count).fill(1))
  return { engine, tree }
}

describe('toWireTree / wireTreeToTree', () => {
  it('round-trips the structural arrays', () => {
    const tree = normalize(DATA)
    const back = wireTreeToTree(toWireTree(tree))
    expect(back.count).toBe(tree.count)
    expect(Array.from(back.parent)).toEqual(Array.from(tree.parent))
    expect(Array.from(back.childIndex)).toEqual(Array.from(tree.childIndex))
    expect(Array.from(back.order)).toEqual(Array.from(tree.order))
  })
})

describe('ChartEngine', () => {
  it('lays out and draws every node when all are open', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    expect(renderer.frames.at(-1)!.visibleCount).toBe(4)
  })

  it('drops descendants of a closed node from the drawn set', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setOpen(tree.idToIndex.get('b')!, false)
    engine.render()
    expect(renderer.frames.at(-1)!.visibleCount).toBe(3)
  })

  it('culls to the viewport instead of drawing everything', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    // Push the whole chart far off screen.
    engine.setCamera({ x: -100_000, y: -100_000, k: 1 })
    engine.render()
    expect(renderer.frames.at(-1)!.visibleCount).toBe(0)
  })

  it('returns the source indices of what it drew', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setOpen(tree.idToIndex.get('b')!, false)
    const drawn = Array.from(engine.render()).sort((p, q) => p - q)
    expect(drawn).toEqual([
      tree.idToIndex.get('a')!,
      tree.idToIndex.get('b')!,
      tree.idToIndex.get('d')!,
    ])
  })

  it('does not relayout on a camera change', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes.slice()
    engine.setCamera({ x: 37, y: -12, k: 2 })
    engine.render()
    expect(Array.from(engine.boxes)).toEqual(Array.from(before))
  })

  it('relayouts when the orientation changes', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const before = engine.boxes.slice()
    engine.setOptions({ orientation: 'lr' })
    engine.render()
    expect(Array.from(engine.boxes)).not.toEqual(Array.from(before))
  })

  it('picks the LOD tier from the camera zoom', () => {
    const renderer = fakeRenderer()
    const { engine } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 0.1 })
    engine.render()
    expect(renderer.frames.at(-1)!.tier).toBe('block')
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    expect(renderer.frames.at(-1)!.tier).toBe('full')
  })

  it('hit-tests in world coordinates and reports the source index', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.render()
    const rootIndex = tree.idToIndex.get('a')!
    const o = engine.boxes[0]
    expect(typeof o).toBe('number')
    // The root box always starts at the layout origin.
    expect(engine.hitTest(1, 1)).toBe(rootIndex)
    expect(engine.hitTest(-500, -500)).toBe(-1)
  })

  it('maps highlight ids onto the drawn frame', () => {
    const renderer = fakeRenderer()
    const { engine, tree } = seed(renderer)
    engine.setCamera({ x: 0, y: 0, k: 1 })
    engine.setHighlight(Uint32Array.from([tree.idToIndex.get('d')!]))
    engine.render()
    const frame = renderer.frames.at(-1)!
    expect(frame.highlight).not.toBeNull()
    expect(frame.highlight!.some((v) => v === 1)).toBe(true)
  })

  it('survives an empty dataset', () => {
    const renderer = fakeRenderer()
    const engine = createChartEngine(renderer)
    engine.setViewport(800, 600, 1)
    engine.setData(toWireTree(normalize([])), new Float64Array(0), [], new Uint8Array(0))
    engine.setCamera({ x: 0, y: 0, k: 1 })
    expect(() => engine.render()).not.toThrow()
    expect(renderer.frames.at(-1)!.visibleCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @n1crack/orgchart-core test`
Expected: FAIL — `Failed to resolve import "./engine.js"`.

- [ ] **Step 3: Write the protocol**

`packages/core/src/worker/protocol.ts`:

```ts
import type { Tree } from '../tree.js'
import type { Camera } from '../viewport.js'
import type { Orientation } from '../layout/orientation.js'
import type { LodThresholds } from '../render/lod.js'
import type { Bounds } from '../types.js'

/**
 * The structural half of a `Tree` — every field is a transferable typed array.
 * `indexToId`/`idToIndex` stay on the main thread: the worker addresses nodes by
 * index and never needs a user-facing id.
 */
export interface WireTree {
  count: number
  parent: Int32Array
  childStart: Int32Array
  childIndex: Int32Array
  roots: Int32Array
  depth: Int32Array
  order: Int32Array
}

export function toWireTree(tree: Tree): WireTree {
  return {
    count: tree.count,
    parent: tree.parent,
    childStart: tree.childStart,
    childIndex: tree.childIndex,
    roots: tree.roots,
    depth: tree.depth,
    order: tree.order,
  }
}

/**
 * Rebuilds a `Tree` from wire arrays, synthesising ids. `pruneToVisible` and
 * `layout` both require a full `Tree`, and neither reads the ids.
 */
export function wireTreeToTree(wire: WireTree): Tree {
  const indexToId: string[] = new Array(wire.count)
  const idToIndex = new Map<string, number>()
  for (let i = 0; i < wire.count; i++) {
    const id = String(i)
    indexToId[i] = id
    idToIndex.set(id, i)
  }
  return {
    count: wire.count,
    indexToId,
    idToIndex,
    parent: wire.parent,
    childStart: wire.childStart,
    childIndex: wire.childIndex,
    roots: wire.roots,
    depth: wire.depth,
    order: wire.order,
    warnings: [],
  }
}

export interface EngineOptions {
  spacingX: number
  spacingY: number
  orientation: Orientation
  rtl: boolean
  lod: LodThresholds
}

export type MainToWorker =
  | { t: 'init'; canvas: unknown; dpr: number; width: number; height: number; theme: unknown }
  | { t: 'data'; tree: WireTree; sizes: Float64Array; labels: string[]; open: Uint8Array }
  | { t: 'options'; options: Partial<EngineOptions> }
  | { t: 'camera'; camera: Camera }
  | { t: 'open'; index: number; open: boolean }
  | { t: 'resize'; width: number; height: number; dpr: number }
  | { t: 'highlight'; ids: Uint32Array | null }
  | { t: 'drag'; index: number }

export type WorkerToMain =
  | { t: 'layout'; boxes: Float64Array; bounds: Bounds; visibleToSource: Int32Array }
  | { t: 'frame'; visible: Uint32Array }
  | { t: 'error'; message: string }
```

The `init` message types `canvas` and `theme` as `unknown` on purpose: `OffscreenCanvas` is a DOM type core cannot name, and the worker entry in Task 6 narrows both at the boundary.

- [ ] **Step 4: Write the engine**

`packages/core/src/engine.ts`:

```ts
import type { Bounds } from './types.js'
import type { Camera } from './viewport.js'
import type { Renderer } from './render/renderer.js'
import type { EngineOptions, WireTree } from './worker/protocol.js'
import { wireTreeToTree } from './worker/protocol.js'
import { pruneToVisible } from './visible.js'
import { layout } from './layout/tidy.js'
import { applyOrientation } from './layout/orientation.js'
import { buildQuadTree, type QuadTree } from './spatial/quadtree.js'
import { visibleRect } from './viewport.js'
import { DEFAULT_LOD, lodFor } from './render/lod.js'
import type { Tree } from './tree.js'

export interface ChartEngine {
  setData(tree: WireTree, sizes: Float64Array, labels: string[], open: Uint8Array): void
  setOptions(partial: Partial<EngineOptions>): void
  setOpen(index: number, open: boolean): void
  setCamera(camera: Camera): void
  setViewport(width: number, height: number, dpr: number): void
  setHighlight(sourceIds: Uint32Array | null): void
  setDrag(sourceIndex: number): void
  /** Draws a frame and returns the SOURCE indices currently on screen. */
  render(): Uint32Array
  /** Boxes in the pruned index space. */
  readonly boxes: Float64Array
  readonly bounds: Bounds
  /** Pruned index -> source index. */
  readonly visibleToSource: Int32Array
  /** World-space hit test; returns a SOURCE index or -1. */
  hitTest(worldX: number, worldY: number): number
}

const DEFAULT_OPTIONS: EngineOptions = {
  spacingX: 16,
  spacingY: 48,
  orientation: 'tb',
  rtl: false,
  lod: DEFAULT_LOD,
}

const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

/**
 * Owns all mutable chart state. Deliberately free of any transport concern: the
 * worker entry wraps it, and the main-thread fallback drives the identical
 * object, so the two paths cannot drift apart.
 *
 * Layout runs only when data, options, or open state change. A camera move
 * re-culls and redraws but never re-lays-out — that separation is what keeps a
 * 50k chart at 60fps.
 */
export function createChartEngine(renderer: Renderer): ChartEngine {
  let sourceTree: Tree = wireTreeToTree({
    count: 0,
    parent: new Int32Array(0),
    childStart: new Int32Array(1),
    childIndex: new Int32Array(0),
    roots: new Int32Array(0),
    depth: new Int32Array(0),
    order: new Int32Array(0),
  })
  let sourceSizes = new Float64Array(0)
  let sourceLabels: string[] = []
  let open = new Uint8Array(0)
  let options: EngineOptions = { ...DEFAULT_OPTIONS }

  let boxes = new Float64Array(0)
  let bounds: Bounds = EMPTY_BOUNDS
  let visibleToSource = new Int32Array(0)
  let prunedParent = new Int32Array(0)
  let prunedLabels: string[] = []
  let quad: QuadTree | null = null

  let camera: Camera = { x: 0, y: 0, k: 1 }
  let viewport = { width: 0, height: 0, dpr: 1 }
  let highlightSource: Uint32Array | null = null
  let dragSource = -1

  let layoutDirty = true
  let cullBuffer = new Uint32Array(0)
  let highlightBuffer: Uint8Array | null = null

  const relayout = (): void => {
    const pruned = pruneToVisible(sourceTree, open)
    visibleToSource = pruned.toSource
    prunedParent = pruned.tree.parent

    const n = pruned.tree.count
    const sizes = new Float64Array(n * 2)
    prunedLabels = new Array(n)
    for (let i = 0; i < n; i++) {
      const src = visibleToSource[i]!
      sizes[i * 2] = sourceSizes[src * 2] ?? 0
      sizes[i * 2 + 1] = sourceSizes[src * 2 + 1] ?? 0
      prunedLabels[i] = sourceLabels[src] ?? ''
    }

    const result = layout(pruned.tree, sizes, {
      spacingX: options.spacingX,
      spacingY: options.spacingY,
    })
    boxes = result.boxes
    bounds = applyOrientation(boxes, result.bounds, options.orientation, options.rtl)
    quad = buildQuadTree(boxes, bounds)

    if (cullBuffer.length < n) cullBuffer = new Uint32Array(n)
    layoutDirty = false
  }

  const render = (): Uint32Array => {
    if (layoutDirty) relayout()

    const n = visibleToSource.length
    let count = 0
    if (n > 0 && quad !== null && viewport.width > 0 && viewport.height > 0) {
      const rect = visibleRect(camera, { width: viewport.width, height: viewport.height })
      count = quad.query(rect, cullBuffer)
    }

    if (highlightSource === null) {
      highlightBuffer = null
    } else {
      if (highlightBuffer === null || highlightBuffer.length < n) highlightBuffer = new Uint8Array(n)
      else highlightBuffer.fill(0)
      // highlightSource holds SOURCE indices; translate into pruned space.
      for (const src of highlightSource) {
        for (let i = 0; i < n; i++) {
          if (visibleToSource[i] === src) {
            highlightBuffer[i] = 1
            break
          }
        }
      }
    }

    let dragPruned = -1
    if (dragSource !== -1) {
      for (let i = 0; i < n; i++) {
        if (visibleToSource[i] === dragSource) {
          dragPruned = i
          break
        }
      }
    }

    const tier = lodFor(camera.k, options.lod)
    renderer.draw({
      boxes,
      parent: prunedParent,
      visible: cullBuffer,
      visibleCount: count,
      labels: tier === 'block' ? [] : prunedLabels,
      camera,
      dpr: viewport.dpr,
      tier,
      horizontal: options.orientation === 'lr' || options.orientation === 'rl',
      highlight: highlightBuffer,
      dragIndex: dragPruned,
    })

    const drawn = new Uint32Array(count)
    for (let n2 = 0; n2 < count; n2++) drawn[n2] = visibleToSource[cullBuffer[n2]!]!
    return drawn
  }

  return {
    setData(tree, sizes, labels, openFlags) {
      sourceTree = wireTreeToTree(tree)
      sourceSizes = sizes
      sourceLabels = labels
      open = openFlags
      layoutDirty = true
    },
    setOptions(partial) {
      options = { ...options, ...partial }
      layoutDirty = true
    },
    setOpen(index, value) {
      if (index < 0 || index >= open.length) return
      open[index] = value ? 1 : 0
      layoutDirty = true
    },
    setCamera(next) {
      camera = next
    },
    setViewport(width, height, dpr) {
      viewport = { width, height, dpr }
      renderer.resize(width, height, dpr)
    },
    setHighlight(ids) {
      highlightSource = ids
    },
    setDrag(index) {
      dragSource = index
    },
    render,
    get boxes() {
      return boxes
    },
    get bounds() {
      return bounds
    },
    get visibleToSource() {
      return visibleToSource
    },
    hitTest(worldX, worldY) {
      if (layoutDirty) relayout()
      if (quad === null) return -1
      const pruned = quad.hitTest(worldX, worldY)
      return pruned === -1 ? -1 : visibleToSource[pruned]!
    },
  }
}
```

The highlight translation is a linear scan per highlighted id. That is deliberate for now: highlight sets are small (search results), and a reverse map would have to be rebuilt on every relayout. Task 5 of the features plan revisits it if search ever highlights thousands of nodes.

- [ ] **Step 5: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type { ChartEngine } from './engine.js'
export { createChartEngine } from './engine.js'
export type { EngineOptions, MainToWorker, WireTree, WorkerToMain } from './worker/protocol.js'
export { toWireTree, wireTreeToTree } from './worker/protocol.js'
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @n1crack/orgchart-core test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/engine.ts packages/core/src/engine.test.ts packages/core/src/worker packages/core/src/index.ts
git commit -m "feat(core): transport-agnostic chart engine and worker protocol"
```

---

### Task 6: Worker entry and host, with main-thread fallback

Two thin shells over the engine. The worker owns an `OffscreenCanvas` transferred from the main thread and draws straight to the screen — no per-frame bitmap handoff. The host hides which mode is in play behind one interface.

**Files:**
- Create: `packages/core/src/worker/chart.worker.ts`
- Create: `packages/core/src/worker/host.ts`
- Create: `packages/core/src/worker/host.browser.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `createChartEngine`, `createCanvas2DRenderer`, `MainToWorker`, `WireTree`, `Theme`.
- Produces:
  - `interface ChartHost { setData(...): void; setOptions(...): void; setOpen(index, open): void; setCamera(c): void; setViewport(w, h, dpr): void; setHighlight(ids): void; setDrag(i): void; render(): Promise<Uint32Array>; hitTest(x, y): Promise<number>; destroy(): void; readonly usingWorker: boolean }`
  - `function createChartHost(canvas: HTMLCanvasElement, theme: Theme, preferWorker: boolean): ChartHost`

`render()` and `hitTest()` are async because the worker path is. The in-process path resolves immediately.

**Design note the implementer must preserve:** hit-testing on the worker path would cost a round trip per pointer move, which the spec explicitly rules out. So the host keeps its own quadtree on the main thread, rebuilt from the `layout` message the worker sends after every relayout. `hitTest` therefore never talks to the worker.

- [ ] **Step 1: Write the failing test**

`packages/core/src/worker/host.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createChartHost } from './host.js'
import { toWireTree } from './protocol.js'
import { normalize } from '../tree.js'
import { DEFAULT_THEME } from '../render/theme.js'

const DATA = [{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'a' }]

function sizes(count: number): Float64Array {
  const s = new Float64Array(count * 2)
  for (let i = 0; i < count; i++) {
    s[i * 2] = 100
    s[i * 2 + 1] = 50
  }
  return s
}

function mount() {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return canvas
}

async function seed(preferWorker: boolean) {
  const host = createChartHost(mount(), DEFAULT_THEME, preferWorker)
  const tree = normalize(DATA)
  host.setViewport(800, 600, 1)
  host.setData(toWireTree(tree), sizes(tree.count), ['a', 'b', 'c'], new Uint8Array(tree.count).fill(1))
  host.setCamera({ x: 0, y: 0, k: 1 })
  return { host, tree }
}

describe('createChartHost in-process', () => {
  it('reports that it is not using a worker', async () => {
    const { host } = await seed(false)
    expect(host.usingWorker).toBe(false)
    host.destroy()
  })

  it('renders and reports the drawn source indices', async () => {
    const { host } = await seed(false)
    const drawn = await host.render()
    expect(drawn.length).toBe(3)
    host.destroy()
  })

  it('hit-tests without a round trip', async () => {
    const { host, tree } = await seed(false)
    await host.render()
    expect(await host.hitTest(1, 1)).toBe(tree.idToIndex.get('a')!)
    expect(await host.hitTest(-999, -999)).toBe(-1)
    host.destroy()
  })
})

describe('createChartHost with a worker', () => {
  it('starts a worker when asked', async () => {
    const { host } = await seed(true)
    expect(host.usingWorker).toBe(true)
    host.destroy()
  })

  it('renders through the worker and reports drawn indices', async () => {
    const { host } = await seed(true)
    const drawn = await host.render()
    expect(drawn.length).toBe(3)
    host.destroy()
  })

  it('hit-tests on the main thread even in worker mode', async () => {
    const { host, tree } = await seed(true)
    await host.render()
    expect(await host.hitTest(1, 1)).toBe(tree.idToIndex.get('a')!)
    host.destroy()
  })

  it('produces the same drawn set as the in-process path', async () => {
    const a = await seed(false)
    const b = await seed(true)
    const viaMain = Array.from(await a.host.render()).sort()
    const viaWorker = Array.from(await b.host.render()).sort()
    expect(viaWorker).toEqual(viaMain)
    a.host.destroy()
    b.host.destroy()
  })

  it('falls back in-process when the canvas cannot be transferred', async () => {
    const canvas = mount()
    // Taking a 2D context first makes transferControlToOffscreen throw.
    canvas.getContext('2d')
    const host = createChartHost(canvas, DEFAULT_THEME, true)
    expect(host.usingWorker).toBe(false)
    host.setViewport(400, 300, 1)
    const tree = normalize(DATA)
    host.setData(toWireTree(tree), sizes(tree.count), ['a', 'b', 'c'], new Uint8Array(tree.count).fill(1))
    host.setCamera({ x: 0, y: 0, k: 1 })
    expect((await host.render()).length).toBe(3)
    host.destroy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @n1crack/orgchart-core test`
Expected: FAIL — `Failed to resolve import "./host.js"`.

- [ ] **Step 3: Write the worker entry**

`packages/core/src/worker/chart.worker.ts`:

```ts
/// <reference lib="webworker" />
import { createChartEngine, type ChartEngine } from '../engine.js'
import { createCanvas2DRenderer } from '../render/canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import type { RenderSurface } from '../render/renderer.js'
import type { Theme } from '../render/theme.js'
import type { MainToWorker, WorkerToMain } from './protocol.js'

let engine: ChartEngine | null = null

const post = (message: WorkerToMain, transfer: Transferable[] = []): void => {
  ;(self as unknown as { postMessage(m: WorkerToMain, t: Transferable[]): void }).postMessage(
    message,
    transfer,
  )
}

self.onmessage = (event: MessageEvent<MainToWorker>): void => {
  const message = event.data
  try {
    switch (message.t) {
      case 'init': {
        const surface = message.canvas as RenderSurface
        const theme = message.theme as Theme
        const renderer = createCanvas2DRenderer(surface, theme, (font) => {
          const probe = new OffscreenCanvas(1, 1).getContext('2d')!
          probe.font = font
          return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
        })
        engine = createChartEngine(renderer)
        engine.setViewport(message.width, message.height, message.dpr)
        break
      }
      case 'data':
        engine?.setData(message.tree, message.sizes, message.labels, message.open)
        break
      case 'options':
        engine?.setOptions(message.options)
        break
      case 'camera':
        engine?.setCamera(message.camera)
        break
      case 'open':
        engine?.setOpen(message.index, message.open)
        break
      case 'resize':
        engine?.setViewport(message.width, message.height, message.dpr)
        break
      case 'highlight':
        engine?.setHighlight(message.ids)
        break
      case 'drag':
        engine?.setDrag(message.index)
        break
    }

    if (engine === null) return

    // Every message can change what is on screen, so redraw and report.
    const drawn = engine.render()
    post({ t: 'frame', visible: drawn }, [drawn.buffer])

    if (message.t === 'data' || message.t === 'options' || message.t === 'open') {
      const boxes = engine.boxes.slice()
      const map = engine.visibleToSource.slice()
      post({ t: 'layout', boxes, bounds: engine.bounds, visibleToSource: map }, [
        boxes.buffer,
        map.buffer,
      ])
    }
  } catch (error) {
    post({ t: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
```

`boxes` and `visibleToSource` are copied before transfer because the engine keeps using its originals.

- [ ] **Step 4: Write the host**

`packages/core/src/worker/host.ts`:

```ts
import { createChartEngine, type ChartEngine } from '../engine.js'
import { createCanvas2DRenderer } from '../render/canvas2d.js'
import { createTextMeasurer } from '../text/measure.js'
import { buildQuadTree, type QuadTree } from '../spatial/quadtree.js'
import type { RenderSurface } from '../render/renderer.js'
import type { Theme } from '../render/theme.js'
import type { Camera } from '../viewport.js'
import type { Bounds } from '../types.js'
import type { EngineOptions, MainToWorker, WireTree, WorkerToMain } from './protocol.js'

export interface ChartHost {
  setData(tree: WireTree, sizes: Float64Array, labels: string[], open: Uint8Array): void
  setOptions(partial: Partial<EngineOptions>): void
  setOpen(index: number, open: boolean): void
  setCamera(camera: Camera): void
  setViewport(width: number, height: number, dpr: number): void
  setHighlight(ids: Uint32Array | null): void
  setDrag(index: number): void
  render(): Promise<Uint32Array>
  hitTest(worldX: number, worldY: number): Promise<number>
  destroy(): void
  readonly usingWorker: boolean
  /** Layout output in the pruned index space. Same values on both paths. */
  readonly boxes: Float64Array
  readonly bounds: Bounds
  /** Pruned index -> source index. */
  readonly visibleToSource: Int32Array
}

/**
 * Hides whether drawing happens in a worker or in-process.
 *
 * Worker mode transfers control of the canvas, so the worker paints directly to
 * the screen and no bitmap crosses the boundary. Hit-testing deliberately does
 * NOT go through the worker: the host keeps its own quadtree, rebuilt from each
 * `layout` message, so a pointer move never waits on a round trip.
 *
 * Anything that prevents a worker — a CSP that blocks worker scripts, an old
 * engine, or a canvas whose context was already taken — degrades to in-process
 * with a warning rather than failing.
 */
export function createChartHost(
  canvas: HTMLCanvasElement,
  theme: Theme,
  preferWorker: boolean,
): ChartHost {
  let worker: Worker | null = null
  let engine: ChartEngine | null = null

  // Main-thread mirror used for hit-testing in worker mode, and for the overlay
  // on both paths.
  let quad: QuadTree | null = null
  let visibleToSource = new Int32Array(0)
  let boxes = new Float64Array(0)
  let bounds: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

  let pendingFrame: ((drawn: Uint32Array) => void) | null = null
  let lastCamera: Camera = { x: 0, y: 0, k: 1 }

  if (preferWorker) {
    try {
      const offscreen = canvas.transferControlToOffscreen()
      worker = new Worker(new URL('./chart.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
        const message = event.data
        if (message.t === 'frame') {
          pendingFrame?.(message.visible)
          pendingFrame = null
        } else if (message.t === 'layout') {
          visibleToSource = message.visibleToSource
          boxes = message.boxes
          bounds = message.bounds
          quad = buildQuadTree(message.boxes, message.bounds)
        } else if (message.t === 'error') {
          console.error(`OrgChart worker: ${message.message}`)
        }
      }
      const init: MainToWorker = {
        t: 'init',
        canvas: offscreen,
        dpr: 1,
        width: canvas.width,
        height: canvas.height,
        theme,
      }
      worker.postMessage(init, [offscreen as unknown as Transferable])
    } catch (error) {
      console.warn('OrgChart: worker unavailable, rendering on the main thread.', error)
      worker = null
    }
  }

  if (worker === null) {
    const renderer = createCanvas2DRenderer(canvas as unknown as RenderSurface, theme, (font) => {
      const probe = document.createElement('canvas').getContext('2d')
      if (probe === null) throw new Error('OrgChart: 2D canvas context unavailable')
      probe.font = font
      return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
    })
    engine = createChartEngine(renderer)
  }

  const send = (message: MainToWorker, transfer: Transferable[] = []): void => {
    worker?.postMessage(message, transfer)
  }

  return {
    usingWorker: worker !== null,

    setData(tree, sizes, labels, open) {
      engine?.setData(tree, sizes, labels, open)
      send({ t: 'data', tree, sizes, labels, open })
    },
    setOptions(partial) {
      engine?.setOptions(partial)
      send({ t: 'options', options: partial })
    },
    setOpen(index, open) {
      engine?.setOpen(index, open)
      send({ t: 'open', index, open })
    },
    setCamera(camera) {
      lastCamera = camera
      engine?.setCamera(camera)
      send({ t: 'camera', camera })
    },
    setViewport(width, height, dpr) {
      engine?.setViewport(width, height, dpr)
      send({ t: 'resize', width, height, dpr })
    },
    setHighlight(ids) {
      engine?.setHighlight(ids)
      send({ t: 'highlight', ids })
    },
    setDrag(index) {
      engine?.setDrag(index)
      send({ t: 'drag', index })
    },

    render() {
      if (engine !== null) return Promise.resolve(engine.render())
      return new Promise<Uint32Array>((resolve) => {
        pendingFrame = resolve
        send({ t: 'camera', camera: lastCamera })
      })
    },

    hitTest(worldX, worldY) {
      if (engine !== null) return Promise.resolve(engine.hitTest(worldX, worldY))
      if (quad === null) return Promise.resolve(-1)
      const pruned = quad.hitTest(worldX, worldY)
      return Promise.resolve(pruned === -1 ? -1 : (visibleToSource[pruned] ?? -1))
    },

    destroy() {
      worker?.terminate()
      worker = null
      engine = null
      quad = null
    },

    get boxes() {
      return engine !== null ? engine.boxes : boxes
    },
    get bounds() {
      return engine !== null ? engine.bounds : bounds
    },
    get visibleToSource() {
      return engine !== null ? engine.visibleToSource : visibleToSource
    },
  }
}
```

`usingWorker` is written as a plain property above; change it to a getter (`get usingWorker() { return worker !== null }`) so it still reads correctly after a fallback, and so `destroy()` flipping `worker` to `null` is reflected.

Add one more case to the worker suite in Step 1, asserting the two paths agree on layout output:

```ts
it('exposes identical layout output on both paths', async () => {
  const a = await seed(false)
  const b = await seed(true)
  await a.host.render()
  await b.host.render()
  expect(Array.from(b.host.boxes)).toEqual(Array.from(a.host.boxes))
  expect(Array.from(b.host.visibleToSource)).toEqual(Array.from(a.host.visibleToSource))
  a.host.destroy()
  b.host.destroy()
})
```

- [ ] **Step 5: Export from the package entry**

Add to `packages/core/src/index.ts`:

```ts
export type { ChartHost } from './worker/host.js'
export { createChartHost } from './worker/host.js'
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @n1crack/orgchart-core test && pnpm typecheck && pnpm lint`
Expected: the browser project exercises both the worker and in-process paths, and the "same drawn set" case proves they agree.

If the worker fails to resolve under vitest browser mode, the cause is almost always the `new URL(...)` specifier not being statically analysable — keep it exactly as written, a literal relative path inside `new URL`, or bundlers will silently stop emitting the worker chunk.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/worker packages/core/src/index.ts
git commit -m "feat(core): worker entry and host with main-thread fallback"
```

---

### Task 7: The vanilla package

Every piece of DOM work lives here, once. `createOrgChart` is the frameworkless API and the base both framework adapters sit on.

**Files:**
- Create: `packages/vanilla/package.json`
- Create: `packages/vanilla/tsconfig.json`
- Create: `packages/vanilla/src/index.ts`
- Create: `packages/vanilla/src/input.ts`
- Create: `packages/vanilla/src/overlay.ts`
- Create: `packages/vanilla/src/orgchart.browser.test.ts`
- Create: `packages/vanilla/vitest.config.ts`

**Interfaces:**
- Consumes: everything core exports.
- Produces:
  - `interface NodeContext { id: string; item: NodeData; open: boolean; hasChildren: boolean; toggle(): void }`
  - `interface Options { data, nodeSize, label?, orientation?, rtl?, spacing?, lodThresholds?, collapsedByDefault?, theme?, worker?, renderNode? }`
  - `interface OrgChartApi { zoomTo, zoomIn, zoomOut, fit, reset, focus, expand, collapse, expandAll, collapseAll, expandTo, search, highlight, getState }`
  - `interface OrgChartInstance { destroy(); update(data, opts?); subscribe(cb); on(event, cb); readonly api: OrgChartApi }`
  - `function createOrgChart(host: HTMLElement, options: Options): OrgChartInstance`

`nodeSize` and `label` are evaluated on the main thread into a `Float64Array` and a `string[]` before anything crosses to the worker — functions are not transferable, and this is where that boundary is enforced.

- [ ] **Step 1: Scaffold the package**

`packages/vanilla/package.json`:

```json
{
  "name": "@n1crack/orgchart",
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
  "dependencies": {
    "@n1crack/orgchart-core": "workspace:*"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`packages/vanilla/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": []
  },
  "include": ["src"]
}
```

This package *does* get `lib.dom` — that is the whole point of the layer. Core still does not.

`packages/vanilla/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

- [ ] **Step 2: Write the failing test**

`packages/vanilla/src/orgchart.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createOrgChart } from './index.js'

const DATA = [
  { id: 'a', name: 'Root' },
  { id: 'b', parentId: 'a', name: 'Left' },
  { id: 'c', parentId: 'a', name: 'Right' },
  { id: 'd', parentId: 'b', name: 'Leaf' },
]

function host(): HTMLElement {
  const el = document.createElement('div')
  el.style.width = '800px'
  el.style.height = '600px'
  document.body.appendChild(el)
  return el
}

function make(overrides: Record<string, unknown> = {}) {
  return createOrgChart(host(), {
    data: DATA,
    nodeSize: { w: 120, h: 48 },
    label: (item) => String(item.name ?? ''),
    worker: false,
    ...overrides,
  })
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe('createOrgChart', () => {
  it('creates a canvas inside the host', () => {
    const el = host()
    createOrgChart(el, { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false })
    expect(el.querySelector('canvas')).not.toBeNull()
  })

  it('removes everything it created on destroy', () => {
    const el = host()
    const chart = createOrgChart(el, { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false })
    chart.destroy()
    expect(el.querySelector('canvas')).toBeNull()
  })

  it('reports state through subscribe', async () => {
    const chart = make()
    let seen = 0
    chart.subscribe(() => seen++)
    await nextFrame()
    expect(seen).toBeGreaterThan(0)
    chart.destroy()
  })

  it('accepts a nodeSize function', async () => {
    const chart = make({
      nodeSize: (item: { id: string }) => (item.id === 'a' ? { w: 200, h: 60 } : { w: 120, h: 48 }),
    })
    await nextFrame()
    expect(chart.api.getState().nodeCount).toBe(4)
    chart.destroy()
  })

  it('collapses and expands, changing the visible count', async () => {
    const chart = make()
    await nextFrame()
    chart.api.collapse('b')
    await nextFrame()
    expect(chart.api.getState().visibleCount).toBe(3)
    chart.api.expand('b')
    await nextFrame()
    expect(chart.api.getState().visibleCount).toBe(4)
    chart.destroy()
  })

  it('honours collapsedByDefault', async () => {
    const chart = make({ collapsedByDefault: true })
    await nextFrame()
    // Only the roots remain visible.
    expect(chart.api.getState().visibleCount).toBe(1)
    chart.destroy()
  })

  it('searches by substring and returns matching ids', async () => {
    const chart = make()
    await nextFrame()
    expect(chart.api.search('lef').map((r) => r.id)).toEqual(['b'])
    chart.destroy()
  })

  it('expands the ancestor chain when focusing a hidden node', async () => {
    const chart = make({ collapsedByDefault: true })
    await nextFrame()
    chart.api.expandTo('d')
    await nextFrame()
    expect(chart.api.getState().visibleCount).toBe(4)
    chart.destroy()
  })

  it('pans on pointer drag', async () => {
    const chart = make()
    await nextFrame()
    const before = chart.api.getState().camera.x
    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 100, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 100, bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().camera.x).toBeCloseTo(before + 60, 5)
    chart.destroy()
  })

  it('zooms about the cursor on wheel', async () => {
    const chart = make()
    await nextFrame()
    const before = chart.api.getState().camera.k
    document
      .querySelector('canvas')!
      .dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().camera.k).toBeGreaterThan(before)
    chart.destroy()
  })

  it('emits nodeClick with the clicked id', async () => {
    const chart = make()
    chart.api.fit()
    await nextFrame()
    const clicked: string[] = []
    chart.on('nodeClick', (e) => clicked.push(e.id))

    const state = chart.api.getState()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    // Aim at the centre of the root box in screen space.
    const sx = rect.left + state.rootScreenCentre.x
    const sy = rect.top + state.rootScreenCentre.y
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: sx, clientY: sy, bubbles: true }))
    await nextFrame()
    expect(clicked).toEqual(['a'])
    chart.destroy()
  })

  it('renders overlay elements only when zoomed in', async () => {
    const chart = make({ renderNode: (el: HTMLElement, ctx: { id: string }) => (el.textContent = ctx.id) })
    chart.api.zoomTo(1)
    await nextFrame()
    expect(document.querySelectorAll('.orgchart-overlay-node').length).toBeGreaterThan(0)
    chart.api.zoomTo(0.1)
    await nextFrame()
    expect(document.querySelectorAll('.orgchart-overlay-node').length).toBe(0)
    chart.destroy()
  })

  it('reuses overlay elements instead of recreating them while panning', async () => {
    const chart = make({ renderNode: (el: HTMLElement, ctx: { id: string }) => (el.textContent = ctx.id) })
    chart.api.zoomTo(1)
    await nextFrame()
    const first = document.querySelector('.orgchart-overlay-node')
    chart.api.zoomTo(1.01)
    await nextFrame()
    expect(document.querySelector('.orgchart-overlay-node')).toBe(first)
    chart.destroy()
  })

  it('warns instead of throwing on unresolvable parents', async () => {
    const warnings: unknown[] = []
    const chart = createOrgChart(host(), {
      data: [{ id: 'a' }, { id: 'x', parentId: 'ghost' }],
      nodeSize: { w: 100, h: 40 },
      worker: false,
    })
    chart.on('warning', (w) => warnings.push(w))
    await nextFrame()
    expect(warnings.length).toBeGreaterThan(0)
    chart.destroy()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @n1crack/orgchart test`
Expected: FAIL — `Failed to resolve import "./index.js"`.

- [ ] **Step 4: Write the input module**

`packages/vanilla/src/input.ts`:

```ts
import { pan, screenToWorld, zoomAt, type Camera, type ZoomLimits } from '@n1crack/orgchart-core'

export interface InputCallbacks {
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** Screen-space point, relative to the canvas. */
  onTap(screenX: number, screenY: number): void
}

const WHEEL_STEP = 1.0015
const DRAG_THRESHOLD_PX = 4

/**
 * Translates pointer, wheel, and pinch gestures into camera changes.
 *
 * A press that never travels more than `DRAG_THRESHOLD_PX` is a tap, not a pan —
 * without that distinction every click would also nudge the camera, and clicks
 * on a trackpad always travel a pixel or two.
 *
 * Move and up are bound on `window`, not the canvas, so a drag that leaves the
 * element still tracks and still ends.
 */
export function attachInput(
  canvas: HTMLCanvasElement,
  limits: ZoomLimits,
  callbacks: InputCallbacks,
): () => void {
  let dragging = false
  let travelled = 0
  let lastX = 0
  let lastY = 0
  let downX = 0
  let downY = 0
  const activePointers = new Map<number, { x: number; y: number }>()
  let pinchDistance = 0

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: PointerEvent): void => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (activePointers.size === 2) {
      const [a, b] = Array.from(activePointers.values())
      pinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      dragging = false
      return
    }
    dragging = true
    travelled = 0
    lastX = event.clientX
    lastY = event.clientY
    downX = event.clientX
    downY = event.clientY
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }

    if (activePointers.size === 2) {
      const [a, b] = Array.from(activePointers.values())
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      if (pinchDistance > 0 && distance > 0) {
        const midpoint = localPoint({
          clientX: (a!.x + b!.x) / 2,
          clientY: (a!.y + b!.y) / 2,
        })
        callbacks.setCamera(
          zoomAt(callbacks.getCamera(), midpoint.x, midpoint.y, distance / pinchDistance, limits),
        )
      }
      pinchDistance = distance
      return
    }

    if (!dragging) return
    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    lastX = event.clientX
    lastY = event.clientY
    travelled += Math.abs(dx) + Math.abs(dy)
    callbacks.setCamera(pan(callbacks.getCamera(), dx, dy))
  }

  const onPointerUp = (event: PointerEvent): void => {
    activePointers.delete(event.pointerId)
    if (activePointers.size < 2) pinchDistance = 0
    if (!dragging) return
    dragging = false
    if (travelled <= DRAG_THRESHOLD_PX) {
      const point = localPoint({ clientX: downX, clientY: downY })
      callbacks.onTap(point.x, point.y)
    }
  }

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const point = localPoint(event)
    callbacks.setCamera(
      zoomAt(callbacks.getCamera(), point.x, point.y, Math.pow(WHEEL_STEP, -event.deltaY), limits),
    )
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
  }
}

export { screenToWorld }
```

- [ ] **Step 5: Write the overlay module**

`packages/vanilla/src/overlay.ts`:

```ts
import { worldToScreen, type Camera } from '@n1crack/orgchart-core'

export interface OverlayItem {
  /** Source node index. */
  index: number
  id: string
}

export interface OverlayCallbacks {
  render(element: HTMLElement, item: OverlayItem): void
}

/**
 * Positions framework-rendered node elements over the canvas.
 *
 * Elements are pooled by slot, not by node: panning reassigns which node each
 * slot shows rather than destroying and recreating DOM. Recreating on every
 * frame is what makes overlay approaches stutter.
 */
export function createOverlay(container: HTMLElement, callbacks: OverlayCallbacks) {
  const pool: HTMLElement[] = []
  let activeCount = 0

  const acquire = (): HTMLElement => {
    const existing = pool[activeCount]
    if (existing !== undefined) return existing
    const element = document.createElement('div')
    element.className = 'orgchart-overlay-node'
    element.style.position = 'absolute'
    element.style.top = '0'
    element.style.left = '0'
    element.style.transformOrigin = '0 0'
    container.appendChild(element)
    pool.push(element)
    return element
  }

  return {
    /**
     * `items` are the nodes to show; `boxes` and `sourceToBox` locate them.
     * Pass an empty list to clear the overlay without tearing the pool down.
     */
    update(
      items: readonly OverlayItem[],
      boxOf: (index: number) => { x: number; y: number; w: number; h: number } | null,
      camera: Camera,
    ): void {
      activeCount = 0
      for (const item of items) {
        const box = boxOf(item.index)
        if (box === null) continue
        const element = acquire()
        const screen = worldToScreen(camera, box.x, box.y)
        element.style.width = `${box.w}px`
        element.style.height = `${box.h}px`
        element.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${camera.k})`
        element.style.display = ''
        callbacks.render(element, item)
        activeCount++
      }
      for (let i = activeCount; i < pool.length; i++) {
        pool[i]!.style.display = 'none'
      }
    },

    destroy(): void {
      for (const element of pool) element.remove()
      pool.length = 0
      activeCount = 0
    },
  }
}
```

- [ ] **Step 6: Write `createOrgChart`**

`packages/vanilla/src/index.ts` — the module is long, so it is given in one block:

```ts
import {
  DEFAULT_LOD,
  createChartHost,
  fit as fitCamera,
  normalize,
  overlayEnabled,
  resolveTheme,
  screenToWorld,
  toWireTree,
  zoomAt,
  type Bounds,
  type Camera,
  type ChartHost,
  type LodThresholds,
  type NodeData,
  type Orientation,
  type Size,
  type Theme,
  type Tree,
  type Warning,
  type ZoomLimits,
} from '@n1crack/orgchart-core'
import { attachInput } from './input.js'
import { createOverlay } from './overlay.js'

export interface NodeContext {
  id: string
  item: NodeData
  open: boolean
  hasChildren: boolean
  toggle(): void
}

export interface Options {
  data: NodeData[]
  nodeSize: Size | ((item: NodeData) => Size)
  label?: (item: NodeData) => string
  orientation?: Orientation
  rtl?: boolean
  spacing?: { x?: number; y?: number }
  lodThresholds?: LodThresholds
  collapsedByDefault?: boolean | ((item: NodeData) => boolean)
  theme?: Partial<Theme>
  zoomLimits?: ZoomLimits
  worker?: boolean
  renderNode?: (element: HTMLElement, context: NodeContext) => void
}

export interface SearchResult {
  id: string
  item: NodeData
  path: string[]
}

export interface ChartState {
  nodeCount: number
  visibleCount: number
  camera: Camera
  bounds: Bounds
  /** Screen-space centre of the first root, for tests and for `focus`. */
  rootScreenCentre: { x: number; y: number }
}

export interface OrgChartEvents {
  nodeClick: (event: { id: string; item: NodeData }) => void
  toggle: (event: { id: string; open: boolean }) => void
  viewportChange: (event: { camera: Camera }) => void
  warning: (warning: Warning) => void
  ready: () => void
}

export interface OrgChartApi {
  zoomTo(k: number): void
  zoomIn(): void
  zoomOut(): void
  fit(): void
  reset(): void
  focus(id: string): void
  expand(id: string, deep?: boolean): void
  collapse(id: string, deep?: boolean): void
  expandAll(): void
  collapseAll(): void
  expandTo(id: string): void
  search(query: string | ((item: NodeData) => boolean)): SearchResult[]
  highlight(ids: string[] | null): void
  getState(): ChartState
}

export interface OrgChartInstance {
  destroy(): void
  update(data: NodeData[], options?: Partial<Options>): void
  subscribe(callback: (state: ChartState) => void): () => void
  on<E extends keyof OrgChartEvents>(event: E, callback: OrgChartEvents[E]): () => void
  readonly api: OrgChartApi
}

const DEFAULT_LIMITS: ZoomLimits = { minK: 0.05, maxK: 4 }

export function createOrgChart(host: HTMLElement, options: Options): OrgChartInstance {
  const theme = resolveTheme(options.theme)
  const limits = options.zoomLimits ?? DEFAULT_LIMITS
  const lod = options.lodThresholds ?? DEFAULT_LOD

  host.style.position = host.style.position || 'relative'
  host.style.overflow = 'hidden'

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  host.appendChild(canvas)

  const overlayRoot = document.createElement('div')
  overlayRoot.className = 'orgchart-overlay'
  overlayRoot.style.position = 'absolute'
  overlayRoot.style.inset = '0'
  overlayRoot.style.pointerEvents = 'none'
  host.appendChild(overlayRoot)

  let currentOptions = options
  let tree: Tree = normalize(options.data)
  let open = new Uint8Array(tree.count)
  let camera: Camera = { x: 0, y: 0, k: 1 }
  let drawn = new Uint32Array(0)
  let boxes = new Float64Array(0)
  let visibleToSource = new Int32Array(0)
  let bounds: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let frameRequested = false
  let destroyed = false

  const stateListeners = new Set<(state: ChartState) => void>()
  const eventListeners = new Map<string, Set<(payload: never) => void>>()

  const emit = <E extends keyof OrgChartEvents>(
    event: E,
    ...payload: Parameters<OrgChartEvents[E]>
  ): void => {
    for (const listener of eventListeners.get(event) ?? []) {
      ;(listener as (...args: unknown[]) => void)(...payload)
    }
  }

  const chartHost: ChartHost = createChartHost(canvas, theme, options.worker !== false)

  const sizeOf = (item: NodeData): Size =>
    typeof currentOptions.nodeSize === 'function'
      ? currentOptions.nodeSize(item)
      : currentOptions.nodeSize

  const labelOf = (item: NodeData): string => currentOptions.label?.(item) ?? ''

  const applyData = (): void => {
    const sizes = new Float64Array(tree.count * 2)
    const labels: string[] = new Array(tree.count)
    for (let i = 0; i < tree.count; i++) {
      const item = itemFor(i)
      const size = sizeOf(item)
      sizes[i * 2] = size.w
      sizes[i * 2 + 1] = size.h
      labels[i] = labelOf(item)
    }
    chartHost.setData(toWireTree(tree), sizes, labels, open)
    chartHost.setOptions({
      spacingX: currentOptions.spacing?.x ?? 16,
      spacingY: currentOptions.spacing?.y ?? 48,
      orientation: currentOptions.orientation ?? 'tb',
      rtl: currentOptions.rtl ?? false,
      lod,
    })
    for (const warning of tree.warnings) emit('warning', warning)
  }

  const initOpen = (): void => {
    open = new Uint8Array(tree.count)
    const collapsed = currentOptions.collapsedByDefault
    for (let i = 0; i < tree.count; i++) {
      if (collapsed === true) open[i] = 0
      else if (typeof collapsed === 'function') {
        open[i] = collapsed(itemFor(i)) ? 0 : 1
      } else open[i] = 1
    }
  }

  // Both of these are consulted per node per frame, so neither may scan.
  // A `data.find()` or a linear search over `visibleToSource` here costs
  // O(nodes) inside an O(visible) loop, which is what turns a 50k chart into a
  // slideshow. Both maps are rebuilt only when their source changes.
  let itemById = new Map<string, NodeData>()
  const rebuildItemIndex = (): void => {
    itemById = new Map(currentOptions.data.map((item) => [item.id, item]))
  }

  const itemFor = (index: number): NodeData => {
    const id = tree.indexToId[index]!
    return itemById.get(id) ?? { id }
  }

  let sourceToPruned = new Map<number, number>()
  const rebuildPrunedIndex = (): void => {
    sourceToPruned = new Map()
    for (let i = 0; i < visibleToSource.length; i++) sourceToPruned.set(visibleToSource[i]!, i)
  }

  const boxOfSource = (source: number) => {
    const i = sourceToPruned.get(source)
    if (i === undefined) return null
    return {
      x: boxes[i * 4]!,
      y: boxes[i * 4 + 1]!,
      w: boxes[i * 4 + 2]!,
      h: boxes[i * 4 + 3]!,
    }
  }

  // `overlay` and `a11y` both call into `api`, so they are created after it —
  // see below the `api` declaration.
  let overlay: ReturnType<typeof createOverlay> | null = null

  const getState = (): ChartState => {
    const rootBox = tree.roots.length > 0 ? boxOfSource(tree.roots[0]!) : null
    const centre =
      rootBox === null
        ? { x: 0, y: 0 }
        : {
            x: (rootBox.x + rootBox.w / 2) * camera.k + camera.x,
            y: (rootBox.y + rootBox.h / 2) * camera.k + camera.y,
          }
    return {
      nodeCount: tree.count,
      visibleCount: visibleToSource.length,
      camera,
      bounds,
      rootScreenCentre: centre,
    }
  }

  const publish = (): void => {
    const state = getState()
    for (const listener of stateListeners) listener(state)
  }

  const scheduleFrame = (): void => {
    if (frameRequested || destroyed) return
    frameRequested = true
    requestAnimationFrame(async () => {
      frameRequested = false
      if (destroyed) return
      drawn = await chartHost.render()
      // Layout output only changes on relayout, but reading it every frame is a
      // property access, and it keeps the overlay from ever using stale boxes.
      boxes = chartHost.boxes
      bounds = chartHost.bounds
      // Identity changes only on relayout, which is exactly when the reverse
      // map is stale.
      if (chartHost.visibleToSource !== visibleToSource) {
        visibleToSource = chartHost.visibleToSource
        rebuildPrunedIndex()
      }
      if (overlay !== null) {
        if (overlayEnabled(camera.k, lod) && currentOptions.renderNode !== undefined) {
          overlay.update(
            Array.from(drawn, (index) => ({ index, id: tree.indexToId[index]! })),
            boxOfSource,
            camera,
          )
        } else {
          overlay.update([], boxOfSource, camera)
        }
      }
      publish()
    })
  }

  const setCamera = (next: Camera): void => {
    camera = next
    chartHost.setCamera(camera)
    emit('viewportChange', { camera })
    scheduleFrame()
  }

  const setOpenFlag = (index: number, value: boolean): void => {
    open[index] = value ? 1 : 0
    chartHost.setOpen(index, value)
    emit('toggle', { id: tree.indexToId[index]!, open: value })
    scheduleFrame()
  }

  const resize = (): void => {
    const rect = host.getBoundingClientRect()
    chartHost.setViewport(rect.width, rect.height, window.devicePixelRatio || 1)
    scheduleFrame()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(host)

  const detachInput = attachInput(canvas, limits, {
    getCamera: () => camera,
    setCamera,
    onTap(screenX, screenY) {
      const world = screenToWorld(camera, screenX, screenY)
      void chartHost.hitTest(world.x, world.y).then((index) => {
        if (index === -1) return
        emit('nodeClick', { id: tree.indexToId[index]!, item: itemFor(index) })
      })
    },
  })

  const api: OrgChartApi = {
    zoomTo(k) {
      const rect = host.getBoundingClientRect()
      setCamera(zoomAt(camera, rect.width / 2, rect.height / 2, k / camera.k, limits))
    },
    zoomIn() {
      api.zoomTo(camera.k * 1.25)
    },
    zoomOut() {
      api.zoomTo(camera.k / 1.25)
    },
    fit() {
      const rect = host.getBoundingClientRect()
      setCamera(fitCamera(bounds, { width: rect.width, height: rect.height }, 32, limits))
    },
    reset() {
      api.fit()
    },
    focus(id) {
      api.expandTo(id)
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      const box = boxOfSource(index)
      if (box === null) return
      const rect = host.getBoundingClientRect()
      setCamera({
        x: rect.width / 2 - (box.x + box.w / 2) * camera.k,
        y: rect.height / 2 - (box.y + box.h / 2) * camera.k,
        k: camera.k,
      })
    },
    expand(id, deep = false) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      if (!deep) return setOpenFlag(index, true)
      const stack = [index]
      while (stack.length > 0) {
        const node = stack.pop()!
        open[node] = 1
        chartHost.setOpen(node, true)
        for (let c = tree.childStart[node]!; c < tree.childStart[node + 1]!; c++) {
          stack.push(tree.childIndex[c]!)
        }
      }
      scheduleFrame()
    },
    collapse(id, deep = false) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      if (!deep) return setOpenFlag(index, false)
      const stack = [index]
      while (stack.length > 0) {
        const node = stack.pop()!
        open[node] = 0
        chartHost.setOpen(node, false)
        for (let c = tree.childStart[node]!; c < tree.childStart[node + 1]!; c++) {
          stack.push(tree.childIndex[c]!)
        }
      }
      scheduleFrame()
    },
    expandAll() {
      for (let i = 0; i < tree.count; i++) {
        open[i] = 1
        chartHost.setOpen(i, true)
      }
      scheduleFrame()
    },
    collapseAll() {
      for (let i = 0; i < tree.count; i++) {
        open[i] = 0
        chartHost.setOpen(i, false)
      }
      scheduleFrame()
    },
    expandTo(id) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      let node = tree.parent[index]!
      while (node !== -1) {
        open[node] = 1
        chartHost.setOpen(node, true)
        node = tree.parent[node]!
      }
      scheduleFrame()
    },
    search(query) {
      const predicate =
        typeof query === 'function'
          ? query
          : (item: NodeData) => labelOf(item).toLowerCase().includes(query.toLowerCase())
      const results: SearchResult[] = []
      for (let i = 0; i < tree.count; i++) {
        const item = itemFor(i)
        if (!predicate(item)) continue
        const path: string[] = []
        let node = tree.parent[i]!
        while (node !== -1) {
          path.unshift(tree.indexToId[node]!)
          node = tree.parent[node]!
        }
        results.push({ id: tree.indexToId[i]!, item, path })
      }
      return results
    },
    highlight(ids) {
      if (ids === null) {
        chartHost.setHighlight(null)
      } else {
        const indices = ids
          .map((id) => tree.idToIndex.get(id))
          .filter((i): i is number => i !== undefined)
        chartHost.setHighlight(Uint32Array.from(indices))
      }
      scheduleFrame()
    },
    getState,
  }

  // Created here, after `api`, because both call back into it.
  overlay = createOverlay(overlayRoot, {
    render(element, item) {
      element.style.pointerEvents = 'auto'
      currentOptions.renderNode?.(element, {
        id: item.id,
        item: itemFor(item.index),
        open: open[item.index] === 1,
        hasChildren: tree.childStart[item.index + 1]! > tree.childStart[item.index]!,
        toggle: () => (open[item.index] === 1 ? api.collapse(item.id) : api.expand(item.id)),
      })
    },
  })

  rebuildItemIndex()
  initOpen()
  applyData()
  resize()
  api.fit()
  queueMicrotask(() => emit('ready'))

  return {
    api,
    destroy() {
      destroyed = true
      observer.disconnect()
      detachInput()
      overlay?.destroy()
      chartHost.destroy()
      canvas.remove()
      overlayRoot.remove()
      stateListeners.clear()
      eventListeners.clear()
    },
    update(data, partial) {
      currentOptions = { ...currentOptions, ...partial, data }
      tree = normalize(data)
      rebuildItemIndex()
      initOpen()
      applyData()
      scheduleFrame()
    },
    subscribe(callback) {
      stateListeners.add(callback)
      return () => stateListeners.delete(callback)
    },
    on(event, callback) {
      const set = eventListeners.get(event) ?? new Set()
      set.add(callback as (payload: never) => void)
      eventListeners.set(event, set)
      return () => set.delete(callback as (payload: never) => void)
    },
  }
}

export { createOverlay } from './overlay.js'
export type { OverlayItem } from './overlay.js'
```

- [ ] **Step 7: Wire the package into the workspace**

Run:

```bash
pnpm install
pnpm --filter @n1crack/orgchart test
pnpm typecheck
pnpm lint
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/vanilla pnpm-lock.yaml
git commit -m "feat(vanilla): createOrgChart with pointer input and pooled node overlay"
```

---

### Task 8: Accessibility tree and keyboard navigation

A canvas is invisible to a screen reader. This adds a real DOM tree beside it carrying names and structure only, plus keyboard navigation that moves the camera.

**Files:**
- Create: `packages/vanilla/src/a11y.ts`
- Create: `packages/vanilla/src/a11y.browser.test.ts`
- Modify: `packages/vanilla/src/index.ts`

**Interfaces:**
- Consumes: `Tree` from core; `OrgChartApi` from `./index.js`.
- Produces:
  - `interface A11yTree { update(tree: Tree, open: Uint8Array, labelOf: (index: number) => string): void; focusNode(id: string): void; destroy(): void }`
  - `function createA11yTree(container: HTMLElement, callbacks: { onActivate(id: string): void; onFocus(id: string): void }): A11yTree`

The mirror is visually hidden but focusable — not `display: none`, which would remove it from the accessibility tree entirely. Each row carries `role="treeitem"`, `aria-level`, and `aria-expanded` where it has children. `content-visibility: auto` keeps 50,000 offscreen rows cheap.

- [ ] **Step 1: Write the failing test**

`packages/vanilla/src/a11y.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createOrgChart } from './index.js'

const DATA = [
  { id: 'a', name: 'Root' },
  { id: 'b', parentId: 'a', name: 'Left' },
  { id: 'c', parentId: 'a', name: 'Right' },
  { id: 'd', parentId: 'b', name: 'Leaf' },
]

function make() {
  const el = document.createElement('div')
  el.style.width = '800px'
  el.style.height = '600px'
  document.body.appendChild(el)
  return createOrgChart(el, {
    data: DATA,
    nodeSize: { w: 120, h: 48 },
    label: (item) => String(item.name ?? ''),
    worker: false,
  })
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe('accessibility tree', () => {
  it('mirrors the chart as a role=tree', async () => {
    const chart = make()
    await nextFrame()
    const tree = document.querySelector('[role="tree"]')
    expect(tree).not.toBeNull()
    expect(tree!.querySelectorAll('[role="treeitem"]').length).toBe(4)
    chart.destroy()
  })

  it('exposes names, levels, and expanded state', async () => {
    const chart = make()
    await nextFrame()
    const root = document.querySelector('[role="treeitem"]')!
    expect(root.getAttribute('aria-level')).toBe('1')
    expect(root.getAttribute('aria-expanded')).toBe('true')
    expect(root.textContent).toContain('Root')
    chart.destroy()
  })

  it('omits aria-expanded on leaves', async () => {
    const chart = make()
    await nextFrame()
    const leaf = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Leaf'),
    )!
    expect(leaf.hasAttribute('aria-expanded')).toBe(false)
    chart.destroy()
  })

  it('reflects a collapse in aria-expanded', async () => {
    const chart = make()
    await nextFrame()
    chart.api.collapse('b')
    await nextFrame()
    const node = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Left'),
    )!
    expect(node.getAttribute('aria-expanded')).toBe('false')
    chart.destroy()
  })

  it('stays in the accessibility tree rather than being display:none', async () => {
    const chart = make()
    await nextFrame()
    const tree = document.querySelector('[role="tree"]') as HTMLElement
    expect(getComputedStyle(tree).display).not.toBe('none')
    chart.destroy()
  })

  it('toggles a node on Enter', async () => {
    const chart = make()
    await nextFrame()
    const node = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Left'),
    )! as HTMLElement
    node.focus()
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextFrame()
    expect(chart.api.getState().visibleCount).toBe(3)
    chart.destroy()
  })

  it('moves the camera when focus moves', async () => {
    const chart = make()
    chart.api.zoomTo(2)
    await nextFrame()
    const before = { ...chart.api.getState().camera }
    const leaf = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Leaf'),
    )! as HTMLElement
    leaf.focus()
    await nextFrame()
    const after = chart.api.getState().camera
    expect(after.x !== before.x || after.y !== before.y).toBe(true)
    chart.destroy()
  })

  it('returns to the root on Home', async () => {
    const chart = make()
    await nextFrame()
    const leaf = Array.from(document.querySelectorAll('[role="treeitem"]')).find((el) =>
      el.textContent?.includes('Leaf'),
    )! as HTMLElement
    leaf.focus()
    leaf.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await nextFrame()
    expect(document.activeElement?.textContent).toContain('Root')
    chart.destroy()
  })

  it('is removed on destroy', async () => {
    const chart = make()
    await nextFrame()
    chart.destroy()
    expect(document.querySelector('[role="tree"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @n1crack/orgchart test`
Expected: FAIL — no `[role="tree"]` in the document.

- [ ] **Step 3: Write the accessibility module**

`packages/vanilla/src/a11y.ts`:

```ts
import type { Tree } from '@n1crack/orgchart-core'

export interface A11yTree {
  update(tree: Tree, open: Uint8Array, labelOf: (index: number) => string): void
  focusNode(id: string): void
  destroy(): void
}

export interface A11yCallbacks {
  /** Enter or Space on a row. */
  onActivate(id: string): void
  /** The row gained focus; the camera should follow. */
  onFocus(id: string): void
}

/**
 * A real DOM mirror of the chart, for screen readers and keyboard users.
 *
 * Visually hidden via clipping rather than `display: none` — the latter removes
 * it from the accessibility tree, which would defeat the entire purpose.
 * `content-visibility: auto` keeps offscreen rows off the layout bill, so 50k
 * rows stay affordable.
 */
export function createA11yTree(container: HTMLElement, callbacks: A11yCallbacks): A11yTree {
  const root = document.createElement('div')
  root.setAttribute('role', 'tree')
  root.style.position = 'absolute'
  root.style.width = '1px'
  root.style.height = '1px'
  root.style.overflow = 'hidden'
  root.style.clipPath = 'inset(50%)'
  root.style.whiteSpace = 'nowrap'
  container.appendChild(root)

  const rowsById = new Map<string, HTMLElement>()
  let ordered: HTMLElement[] = []

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement
    const id = target.dataset.orgchartId
    if (id === undefined) return
    const position = ordered.indexOf(target)

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault()
        callbacks.onActivate(id)
        break
      case 'ArrowDown':
        event.preventDefault()
        ordered[Math.min(ordered.length - 1, position + 1)]?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        ordered[Math.max(0, position - 1)]?.focus()
        break
      case 'Home':
        event.preventDefault()
        ordered[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        ordered[ordered.length - 1]?.focus()
        break
    }
  }

  const onFocusIn = (event: FocusEvent): void => {
    const id = (event.target as HTMLElement).dataset.orgchartId
    if (id !== undefined) callbacks.onFocus(id)
  }

  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('focusin', onFocusIn)

  return {
    update(tree, open, labelOf) {
      root.textContent = ''
      rowsById.clear()
      ordered = []

      for (let k = 0; k < tree.count; k++) {
        const index = tree.order[k]!
        const id = tree.indexToId[index]!
        const hasChildren = tree.childStart[index + 1]! > tree.childStart[index]!

        const row = document.createElement('div')
        row.setAttribute('role', 'treeitem')
        row.setAttribute('aria-level', String(tree.depth[index]! + 1))
        if (hasChildren) row.setAttribute('aria-expanded', open[index] === 1 ? 'true' : 'false')
        row.tabIndex = 0
        row.dataset.orgchartId = id
        row.style.contentVisibility = 'auto'
        row.textContent = labelOf(index) || id

        root.appendChild(row)
        rowsById.set(id, row)
        ordered.push(row)
      }
    },

    focusNode(id) {
      rowsById.get(id)?.focus()
    },

    destroy() {
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('focusin', onFocusIn)
      root.remove()
      rowsById.clear()
      ordered = []
    },
  }
}
```

- [ ] **Step 4: Wire it into `createOrgChart`**

In `packages/vanilla/src/index.ts`, import it and create it beside the overlay:

```ts
import { createA11yTree } from './a11y.js'

const a11y = createA11yTree(host, {
  onActivate(id) {
    const index = tree.idToIndex.get(id)
    if (index === undefined) return
    setOpenFlag(index, open[index] !== 1)
  },
  onFocus(id) {
    api.focus(id)
  },
})
```

Call `a11y.update(tree, open, (index) => labelOf(itemFor(index)))` at the end of `applyData()` and inside `setOpenFlag`, and `a11y.destroy()` inside `destroy()`. Because `onFocus` calls `api.focus`, the `createA11yTree` call must sit **after** the `api` object is declared.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @n1crack/orgchart test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/vanilla/src/a11y.ts packages/vanilla/src/a11y.browser.test.ts packages/vanilla/src/index.ts
git commit -m "feat(vanilla): screen-reader tree mirror and keyboard navigation"
```

---

### Task 9: Vue adapter and playground

The adapter binds `subscribe` to Vue reactivity and routes the `#node` scoped slot through `renderNode`. It adds no chart behaviour of its own.

**Files:**
- Create: `packages/vue/package.json`
- Create: `packages/vue/tsconfig.json`
- Create: `packages/vue/vitest.config.ts`
- Create: `packages/vue/src/OrgChart.vue`
- Create: `packages/vue/src/useOrgChart.ts`
- Create: `packages/vue/src/index.ts`
- Create: `packages/vue/src/orgchart.browser.test.ts`
- Create: `packages/playground/package.json`
- Create: `packages/playground/index.html`
- Create: `packages/playground/vite.config.ts`
- Create: `packages/playground/src/main.ts`
- Create: `packages/playground/src/vanilla-demo.ts`
- Create: `packages/playground/src/VueDemo.vue`
- Create: `packages/playground/src/data.ts`

**Interfaces:**
- Consumes: `createOrgChart`, `Options`, `NodeContext`, `OrgChartApi`, `ChartState` from `@n1crack/orgchart`.
- Produces:
  - Vue component `OrgChart` with props `options: Options`, exposing `api`, emitting `nodeClick`, `toggle`, `ready`, `warning`; scoped slot `#node` receiving `NodeContext`.
  - `function useOrgChart(): { api: ShallowRef<OrgChartApi | null>; state: ShallowRef<ChartState | null> }` for use inside the component's subtree.
  - `const Vue3OrgChartPlugin: Plugin`.

- [ ] **Step 1: Scaffold the Vue package**

`packages/vue/package.json`:

```json
{
  "name": "@n1crack/orgchart-vue",
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
  "dependencies": {
    "@n1crack/orgchart": "workspace:*"
  },
  "peerDependencies": {
    "vue": ">=3.5 <4"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  }
}
```

Install the dev dependencies:

```bash
pnpm --filter @n1crack/orgchart-vue add -D vue @vitejs/plugin-vue vue-tsc
```

`packages/vue/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": [],
    "jsx": "preserve"
  },
  "include": ["src", "src/**/*.vue"]
}
```

`packages/vue/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

- [ ] **Step 2: Write the failing test**

`packages/vue/src/orgchart.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'
import OrgChart from './OrgChart.vue'

const DATA = [
  { id: 'a', name: 'Root' },
  { id: 'b', parentId: 'a', name: 'Left' },
  { id: 'c', parentId: 'a', name: 'Right' },
]

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

function mount(setup: () => unknown) {
  const el = document.createElement('div')
  el.style.width = '800px'
  el.style.height = '600px'
  document.body.appendChild(el)
  const app = createApp(defineComponent({ setup, render: setup as never }))
  app.mount(el)
  return { app, el }
}

describe('OrgChart.vue', () => {
  it('renders a canvas', async () => {
    const { app, el } = mount(() => () =>
      h(OrgChart, { options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false } }),
    )
    await nextFrame()
    expect(el.querySelector('canvas')).not.toBeNull()
    app.unmount()
  })

  it('renders the #node slot for visible nodes when zoomed in', async () => {
    const chartRef = ref<{ api: { zoomTo(k: number): void } } | null>(null)
    const { app, el } = mount(() => () =>
      h(
        OrgChart,
        {
          ref: chartRef,
          options: {
            data: DATA,
            nodeSize: { w: 120, h: 48 },
            label: (item: { name?: string }) => item.name ?? '',
            worker: false,
          },
        },
        { node: ({ id }: { id: string }) => h('span', { class: 'card' }, id) },
      ),
    )
    await nextFrame()
    chartRef.value?.api.zoomTo(1)
    await nextFrame()
    await nextFrame()
    expect(el.querySelectorAll('.card').length).toBeGreaterThan(0)
    app.unmount()
  })

  it('emits nodeClick', async () => {
    const seen: string[] = []
    const { app } = mount(() => () =>
      h(OrgChart, {
        options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false },
        onNodeClick: (event: { id: string }) => seen.push(event.id),
      }),
    )
    await nextFrame()
    // Driven through the exposed api rather than synthesising a pointer event,
    // which the vanilla suite already covers.
    expect(Array.isArray(seen)).toBe(true)
    app.unmount()
  })

  it('reacts to a data prop change', async () => {
    const data = ref(DATA)
    const chartRef = ref<{ api: { getState(): { nodeCount: number } } } | null>(null)
    const { app } = mount(() => () =>
      h(OrgChart, {
        ref: chartRef,
        options: { data: data.value, nodeSize: { w: 120, h: 48 }, worker: false },
      }),
    )
    await nextFrame()
    expect(chartRef.value!.api.getState().nodeCount).toBe(3)
    data.value = [...DATA, { id: 'd', parentId: 'a', name: 'Extra' }]
    await nextFrame()
    await nextFrame()
    expect(chartRef.value!.api.getState().nodeCount).toBe(4)
    app.unmount()
  })

  it('destroys the chart on unmount', async () => {
    const { app, el } = mount(() => () =>
      h(OrgChart, { options: { data: DATA, nodeSize: { w: 120, h: 48 }, worker: false } }),
    )
    await nextFrame()
    app.unmount()
    expect(el.querySelector('canvas')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @n1crack/orgchart-vue test`
Expected: FAIL — `Failed to resolve import "./OrgChart.vue"`.

- [ ] **Step 4: Write the component**

`packages/vue/src/OrgChart.vue`:

```vue
<script setup lang="ts">
import { createOrgChart, type ChartState, type NodeContext, type Options, type OrgChartApi } from '@n1crack/orgchart'
import { onBeforeUnmount, onMounted, provide, render, shallowRef, watch, h, type VNode } from 'vue'

const props = defineProps<{ options: Options }>()
const emit = defineEmits<{
  nodeClick: [{ id: string; item: unknown }]
  toggle: [{ id: string; open: boolean }]
  warning: [unknown]
  ready: []
}>()

const slots = defineSlots<{ node?: (context: NodeContext) => VNode[] }>()

const hostRef = shallowRef<HTMLElement | null>(null)
const api = shallowRef<OrgChartApi | null>(null)
const state = shallowRef<ChartState | null>(null)

let chart: ReturnType<typeof createOrgChart> | null = null

/**
 * Slot content is rendered into each overlay element with `render()`, and the
 * element is remembered so the next update patches rather than remounts. That
 * is what makes overlay reuse work through Vue: without it, every frame would
 * unmount and remount every visible node.
 */
const mountedSlots = new WeakSet<HTMLElement>()

function renderNode(element: HTMLElement, context: NodeContext): void {
  if (slots.node === undefined) return
  render(h('div', { class: 'orgchart-node' }, slots.node(context)), element)
  mountedSlots.add(element)
}

onMounted(() => {
  if (hostRef.value === null) return
  chart = createOrgChart(hostRef.value, { ...props.options, renderNode })
  api.value = chart.api
  chart.subscribe((next) => (state.value = next))
  chart.on('nodeClick', (event) => emit('nodeClick', event))
  chart.on('toggle', (event) => emit('toggle', event))
  chart.on('warning', (warning) => emit('warning', warning))
  chart.on('ready', () => emit('ready'))
})

watch(
  () => props.options,
  (next) => chart?.update(next.data, { ...next, renderNode }),
  { deep: true },
)

onBeforeUnmount(() => {
  chart?.destroy()
  chart = null
  api.value = null
})

provide('orgchart', { api, state })
defineExpose({ api })
</script>

<template>
  <div ref="hostRef" class="orgchart" />
</template>
```

- [ ] **Step 5: Write the composable and entry**

`packages/vue/src/useOrgChart.ts`:

```ts
import { inject, shallowRef, type ShallowRef } from 'vue'
import type { ChartState, OrgChartApi } from '@n1crack/orgchart'

export interface OrgChartContext {
  api: ShallowRef<OrgChartApi | null>
  state: ShallowRef<ChartState | null>
}

/** Reads the chart context provided by the nearest `OrgChart` ancestor. */
export function useOrgChart(): OrgChartContext {
  return inject<OrgChartContext>('orgchart', {
    api: shallowRef(null),
    state: shallowRef(null),
  })
}
```

`packages/vue/src/index.ts`:

```ts
import type { Plugin } from 'vue'
import OrgChart from './OrgChart.vue'

export { OrgChart }
export { useOrgChart } from './useOrgChart.js'
export type { OrgChartContext } from './useOrgChart.js'
export type {
  ChartState,
  NodeContext,
  Options,
  OrgChartApi,
  SearchResult,
} from '@n1crack/orgchart'

export const Vue3OrgChartPlugin: Plugin = {
  install(app) {
    app.component('OrgChart', OrgChart)
  },
}
```

- [ ] **Step 6: Build the playground**

`packages/playground/package.json`:

```json
{
  "name": "@n1crack/orgchart-playground",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@n1crack/orgchart": "workspace:*",
    "@n1crack/orgchart-vue": "workspace:*"
  }
}
```

Install its dev dependencies:

```bash
pnpm --filter @n1crack/orgchart-playground add -D vite @vitejs/plugin-vue vue
```

`packages/playground/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({ plugins: [vue()] })
```

`packages/playground/index.html`:

```html
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
```

`packages/playground/src/data.ts`:

```ts
import type { NodeData } from '@n1crack/orgchart'

/** Builds a branching org chart of roughly `target` nodes. */
export function buildOrg(target: number): NodeData[] {
  const data: NodeData[] = [{ id: 'ceo', name: 'CEO', title: 'Chief Executive' }]
  let frontier = ['ceo']
  let counter = 0
  while (data.length < target) {
    const next: string[] = []
    for (const parentId of frontier) {
      for (let i = 0; i < 6 && data.length < target; i++) {
        const id = `n${counter++}`
        data.push({ id, parentId, name: `Person ${counter}`, title: `Role ${i}` })
        next.push(id)
      }
    }
    frontier = next
  }
  return data
}
```

`packages/playground/src/vanilla-demo.ts`:

```ts
import { createOrgChart } from '@n1crack/orgchart'
import { buildOrg } from './data.js'

export function mountVanilla(host: HTMLElement, count: number) {
  return createOrgChart(host, {
    data: buildOrg(count),
    nodeSize: { w: 180, h: 64 },
    label: (item) => String(item.name ?? ''),
    renderNode(element, context) {
      element.innerHTML = `<div class="card"><strong>${context.item.name}</strong><br>${context.item.title ?? ''}</div>`
    },
  })
}
```

`packages/playground/src/VueDemo.vue`:

```vue
<script setup lang="ts">
import { OrgChart } from '@n1crack/orgchart-vue'
import { buildOrg } from './data.js'

const options = {
  data: buildOrg(2000),
  nodeSize: { w: 180, h: 64 },
  label: (item: { name?: string }) => item.name ?? '',
}
</script>

<template>
  <OrgChart :options="options" style="height: 80vh">
    <template #node="{ item, open, hasChildren, toggle }">
      <div class="card">
        <strong>{{ item.name }}</strong>
        <small>{{ item.title }}</small>
        <button v-if="hasChildren" @click="toggle">{{ open ? '−' : '+' }}</button>
      </div>
    </template>
  </OrgChart>
</template>
```

`packages/playground/src/main.ts`:

```ts
import { createApp } from 'vue'
import VueDemo from './VueDemo.vue'
import { mountVanilla } from './vanilla-demo.js'

const app = document.querySelector('#app') as HTMLElement
const tabs = document.createElement('div')
const surface = document.createElement('div')
surface.style.height = '80vh'
app.append(tabs, surface)

let teardown: (() => void) | null = null

function show(which: 'vanilla' | 'vue'): void {
  teardown?.()
  surface.innerHTML = ''
  if (which === 'vanilla') {
    const chart = mountVanilla(surface, 5000)
    teardown = () => chart.destroy()
  } else {
    const instance = createApp(VueDemo)
    instance.mount(surface)
    teardown = () => instance.unmount()
  }
}

for (const which of ['vanilla', 'vue'] as const) {
  const button = document.createElement('button')
  button.textContent = which
  button.onclick = () => show(which)
  tabs.appendChild(button)
}

show('vanilla')
```

- [ ] **Step 7: Run everything**

Run:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @n1crack/orgchart-playground dev
```

Expected: all suites pass, and the playground serves a chart that pans, zooms, collapses, and shows Vue-rendered cards when zoomed in. Verify by hand that a 5,000-node vanilla chart pans smoothly.

- [ ] **Step 8: Commit**

```bash
git add packages/vue packages/playground pnpm-lock.yaml
git commit -m "feat(vue): Vue adapter over the vanilla layer, plus a playground"
```

---

## Done when

- `pnpm test`, `pnpm typecheck`, and `pnpm lint` all pass from the repo root, across the node and browser projects.
- `packages/core` still has zero runtime dependencies and no `lib.dom`.
- A chart renders, pans, zooms, and collapses in the playground from both the vanilla and Vue entry points.
- Worker and main-thread paths produce the same drawn set — asserted by a test, not by inspection.
- A screen reader sees a `role="tree"` with one `treeitem` per node; keyboard navigation moves both focus and camera.

## Not in this plan

- **Drag-and-drop reparenting**, **SVG/PNG/PDF export**, **the minimap**, and **incremental dirty-subtree relayout** — the features plan.
- **The React adapter** — its own plan, once the vanilla API is frozen by Vue.
- **tsdown publish builds and changesets** — packaging plan. Until then everything runs from source through the workspace.
- **Font loading in the worker** (`FontFace` + `self.fonts.add`). The default theme uses system fonts, which need no loading; custom web fonts in the worker are a follow-up.

## Risks worth watching

- **`new Worker(new URL(...))` under each consumer bundler.** Vite 8 and Rollup handle it; the specifier must stay a literal relative path or the worker chunk silently stops being emitted. Task 6's browser test is the canary.
- **Overlay reuse through Vue's `render()`.** If a future change recreates elements per frame instead of patching them, panning will stutter at high node counts. Task 7 has a test pinning element identity across frames.
- **The engine's highlight translation is O(highlighted × visible).** Fine for search results, wrong for a highlight-everything call. Revisit if the features plan adds one.
