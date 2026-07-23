# Klados v1.0 — Framework-Agnostic Rework

**Date:** 2026-07-21
**Status:** Approved design, ready for implementation planning
**Supersedes:** `vue3-org-chart` v0.2.5 (DOM/flex recursive rendering)
**Target repo:** `n1crack/orgchart`

---

## 1. Problem

`vue3-org-chart` v0.2.5 renders every node as a recursive Vue component in the DOM,
draws connector lines with CSS pseudo-elements, and delegates pan/zoom to the
`panzoom` package. This works to roughly 500 nodes. It cannot reach the new target
of 5,000–50,000 nodes: 50k Vue component instances plus 50k CSS-line elements
exhaust both memory and layout time.

The component is also Vue-only. The new goal is one rendering engine consumed by
multiple frameworks.

## 2. Goals

- Render 5,000–50,000 nodes at 60fps.
- Framework-agnostic core, with a first-class vanilla TypeScript API — no framework required.
- Vue and React adapters on top of the vanilla layer. Svelte decided later.
- Zero third-party runtime dependencies. `panzoom` is replaced by an in-house viewport.
- Retain per-node custom templates (framework slots) without paying for them at scale.
- Ship drag-drop reparenting, search/focus, vector export, and layout orientations.

## 3. Non-goals

- Backwards compatibility with v0.2.5. This is a breaking v1.0 with a migration guide.
- WebGPU/WebGL rendering. Evaluated and rejected (§5.2).
- Auto-sizing nodes from rendered content. Rejected (§6.3).
- Svelte adapter. Deferred; the design must not be shaped by it.

## 4. Scope decomposition

This design covers **spec 1 only**: `core` + `vanilla` + `vue`. React is spec 2, built
after the API is validated and frozen by the Vue adapter. Svelte is a later decision.

Building Vue first is deliberate: an API designed against zero real consumers is
usually wrong, and discovering that in one adapter is cheaper than in three.

## 5. Rendering architecture

### 5.1 Chosen approach: Canvas2D in a worker + DOM overlay

The whole tree is rasterized to a `<canvas>` whose control is transferred to a
Web Worker via `transferControlToOffscreen()`. The worker owns layout and drawing.
Above a zoom threshold, the main thread renders real framework components as an
absolutely-positioned DOM overlay for the nodes currently in the viewport
(roughly 50 instances, constant regardless of tree size).

```
main thread:  pointer input, framework slots, hit-test (quadtree), API surface
worker:       tidy-tree layout + canvas rasterization (OffscreenCanvas)
```

This preserves full template flexibility exactly where a user can perceive it —
when zoomed in far enough to read a card — and pays nothing for it when zoomed out.

### 5.2 Rejected alternatives

**SVG + viewport culling.** Lighter than DOM, free export, easy a11y, CSS styling.
Ceiling is roughly 5,000 nodes; SVG layout and paint collapse well before 50k.
Does not meet the scale target.

**WebGPU / WebGL2.** Scales past 100k with instanced quads and an SDF text atlas.
Rejected on two counts: WebGPU is only Baseline *newly available* as of Jan 2026
(~70% real-world support; Firefox on Linux and Android are gaps), so a full 2D
fallback path is mandatory anyway — two renderers to maintain. And 50k does not
require it. Canvas2D reaches the target with a fraction of the complexity.

The renderer sits behind a `Renderer` interface so a WebGPU backend can be added
later without touching the core.

## 6. Package structure

```
packages/
  core/          @klados/core    pure TS, no DOM, worker-safe, zero deps
  vanilla/       klados         DOM binding layer, no framework
  vue/           @klados/vue     peer: vue >=3.5 <4
  react/         @klados/react   peer: react >=19        (spec 2)
  playground/    vite 8 demo, private
```

The layering is strict:

```
core     pure logic: layout, viewport maths, spatial index, worker protocol
  ^
vanilla  canvas element, pointer input, worker bootstrap, overlay host
  ^                    ^
vue                  react        slot rendering + reactivity binding only
```

`vanilla` is the frameworkless API and a supported first-class consumer, not a
byproduct. Every piece of DOM work — creating the canvas, wiring pointer and
keyboard events, starting the worker, positioning the overlay host — lives there
once. Vue and React add only what is genuinely framework-specific: rendering node
templates through slots or render props, and binding `subscribe` to the
framework's reactivity system. That keeps each framework adapter near 150 lines
and means a bug in pointer handling is fixed in one place, not three.

`vanilla` depends on `core`, and `vue`/`react` depend on `vanilla` — all real
dependencies, not peers, so users install a single package. Third-party runtime
dependencies remain at zero.

### 6.1 Core layout

```
packages/core/src/
  tree.ts                # normalize, index, parent/child maps, mutation, cycle detection
  layout/tidy.ts         # van der Ploeg non-layered tidy tree (linear time)
  layout/orientation.ts  # TB / BT / LR / RL + RTL mirroring
  spatial/quadtree.ts    # viewport culling + hit-test
  viewport.ts            # pan/zoom matrix, inertia, clamping (replaces panzoom)
  render/renderer.ts     # Renderer interface
  render/canvas2d.ts     # Canvas2D backend
  render/svg.ts          # SVG serializer for export (same layout output)
  text/measure.ts        # text measurement cache + binary-search truncation
  worker/chart.worker.ts # layout + raster, OffscreenCanvas
  worker/protocol.ts     # typed message contract, single source of truth
```

Each file has one job and can be understood without reading its neighbours.
`tidy.ts` takes node sizes and a parent map and returns coordinates; it knows
nothing about canvas, workers, or frameworks.

### 6.2 The vanilla API and the framework bridge

`vanilla` exports one factory. This is the whole frameworkless API:

```ts
function createKlados(host: HTMLElement, options: Options): KladosInstance

interface KladosInstance {
  destroy(): void
  update(data: NodeData[], opts: Partial<Options>): void
  subscribe(cb: (s: ChartState) => void): () => void
  on<E extends keyof Events>(event: E, cb: Events[E]): () => void
  readonly api: KladosApi
}
```

`createKlados` creates the canvas inside `host`, starts the worker, and attaches
input handling. A user with no framework calls it directly and is done.

Framework adapters bind to this and nothing else. Vue uses `shallowRef` +
`watchEffect`; React uses `useSyncExternalStore` — both against the same
`subscribe`. Layout, rendering, hit-testing, and input handling are never
duplicated per framework.

Node content is the one genuinely framework-specific piece (Vue scoped slot,
React render prop, Svelte snippet). `core` defines the shared `NodeContext` type;
`vanilla` renders node overlays through a plain callback
(`renderNode(el: HTMLElement, ctx: NodeContext): void`), and each framework
adapter implements that callback in its own idiom.

### 6.3 Node sizing (declarative, required)

```ts
nodeSize: Size | ((item: NodeData) => Size)
```

Node dimensions come from props, not from measuring rendered content. The worker
has no DOM and cannot measure a framework slot. Content fits the box; content does
not determine the box.

Auto-sizing was rejected: it requires mounting every node to the DOM once before
layout can run, which reinstates the exact cost this rework removes.

## 7. Layout engine

`layout/tidy.ts` implements van der Ploeg's "Drawing Non-layered Tidy Trees in
Linear Time" from scratch — not a port of `d3-hierarchy`, which supports only
fixed-size nodes and would be a runtime dependency.

Three passes:
1. `firstWalk` — contour tracking and shift accumulation.
2. `secondWalk` — resolve absolute x from accumulated shifts.
3. `applyOrientation` — TB/BT/LR/RL plus RTL mirroring.

Output is a flat `Float32Array` of `[x, y, w, h]` per node — transferable to the
main thread with zero copying.

**Incremental relayout.** Collapse, expand, and reparent do not recompute the whole
tree. The changed subtree and its ancestor chain are marked dirty; sibling contours
are served from cache. A cold full layout runs once; everything after is
dirty-subtree work.

## 8. Worker protocol

`worker/protocol.ts` is a discriminated union shared verbatim by both sides.

```ts
// main -> worker
| { t: 'init',   canvas: OffscreenCanvas, dpr: number }
| { t: 'data',   nodes: ArrayBuffer, opts: LayoutOpts }   // transferred
| { t: 'camera', x: number, y: number, k: number }        // per frame
| { t: 'toggle', id: number, open: boolean }
| { t: 'resize', w: number, h: number, dpr: number }
| { t: 'drag',   id: number | null, x: number, y: number }
| { t: 'highlight', ids: Uint32Array | null }

// worker -> main
| { t: 'layout',  boxes: ArrayBuffer, bounds: Bounds }    // transferred
| { t: 'frame',   visible: Uint32Array }                  // ids needing DOM overlay
| { t: 'warning', code: WarningCode, detail: string }
```

**`postMessage`, not `SharedArrayBuffer`.** SAB requires COOP/COEP response headers,
which a library cannot impose on its consumers. The structured-clone cost of three
numbers per frame is negligible.

### 8.1 Identifier mapping

The public API uses the user's own `string` ids throughout. The worker protocol and
all typed arrays use dense `uint32` indices instead, because ids must travel in
transferable buffers.

`tree.ts` owns the mapping and is the only place that knows about it: it assigns each
node an index on normalize, and exposes `idToIndex: Map<string, number>` and
`indexToId: string[]`. Adapters and the public API never see indices; the worker never
sees strings. Reindexing happens only on `update()`, not on toggle or reparent.

## 9. Render pipeline

Canvas control is transferred to the worker, so the worker draws straight to the
screen — no per-frame bitmap handoff.

Per frame: camera -> quadtree query -> visible boxes -> LOD selection -> draw.

### 9.1 Level of detail

| zoom | drawn | DOM overlay |
|---|---|---|
| `< 0.25` | 1px rectangles + connector lines, no text | none |
| `0.25–0.6` | box + truncated single-line name | none |
| `>= 0.6` | box and label as above; the DOM overlay draws the card | **on** — framework slots for viewport nodes |

Thresholds are configurable via `lodThresholds`.

Edges are batched into a single `Path2D` per frame — no per-node stroke call.

### 9.2 Text

`text/measure.ts` caches `measureText` results in a `Map<string, number>`. Fonts are
loaded in the worker via `FontFace` + `self.fonts.add`. Truncation is a binary search
over the cache, so measurement calls grow logarithmically, not linearly.

### 9.3 Hit-testing and overlay

Hit-testing runs on the **main thread** against its own copy of the quadtree, built
from the `boxes` buffer delivered with each `layout` message. Pointer events never
round-trip to the worker, so click latency is zero.

`NodeOverlay` renders slots only for ids listed in the latest `frame` message, and
positions them with `transform: translate3d()`. The node pool is recycled (key = slot
index, item = id) to avoid mount/unmount churn while panning.

## 10. Public API

```ts
interface Options {
  data: NodeData[]                                   // { id, parentId?, ...user fields }
  nodeSize: Size | ((item: NodeData) => Size)
  orientation?: 'tb' | 'bt' | 'lr' | 'rl'            // default 'tb'
  rtl?: boolean
  spacing?: { x?: number, y?: number }
  lodThresholds?: { text: number, overlay: number }   // default 0.25 / 0.6
  collapsedByDefault?: boolean | ((item: NodeData) => boolean)
  theme?: Partial<Theme>                              // canvas drawing tokens
  minimap?: boolean | MinimapOptions                  // default false
  worker?: boolean                                    // default true; off for CSP/tests
}

interface KladosApi {
  // camera
  zoomTo(k: number, opts?: ZoomOpts): void
  zoomIn(): void
  zoomOut(): void
  fit(): void
  reset(): void
  focus(id: string, opts?: { zoom?: number, animate?: boolean }): void
  // tree
  expand(id: string, deep?: boolean): void
  collapse(id: string, deep?: boolean): void
  expandAll(): void
  collapseAll(): void
  expandTo(id: string): void                          // opens the ancestor chain
  // search
  search(q: string | ((item: NodeData) => boolean)): SearchResult[]
  highlight(ids: string[] | null): void
  // editing
  reparent(id: string, newParentId: string): boolean  // rejects cycles
  // export
  toSVG(opts?: ExportOpts): string
  toBlob(opts?: { format: 'png' | 'jpeg', scale?: number }): Promise<Blob>
  print(): void
  // state
  getState(): ChartState
}
```

Events: `nodeClick`, `nodeDblClick`, `nodeHover`, `toggle`, `reparent`,
`viewportChange`, `ready`, `warning`.

## 11. Features

### 11.1 Drag-drop reparenting

Pointer events on the main thread; the dragged node is drawn as a ghost by the worker
over the `drag` message channel. Drop targets are highlighted via quadtree hit-test.

On drop, `reparent` runs a cycle check — is the new parent inside the dragged node's
own subtree? If so the operation is rejected and the event reports `prevented`.

A successful reparent triggers a dirty-subtree relayout with a 200ms tween between
old and new positions.

Touch: drag starts on long-press. `touch-action: none` is applied only while dragging,
so normal touch panning is unaffected.

### 11.2 Search and focus

`search()` is a linear scan on the main thread — under 5ms at 50k nodes, so no index
is built. It returns matching ids plus their ancestor paths. `highlight()` forwards
an id set to the worker for highlight-coloured drawing. `focus()` expands the ancestor
chain and tweens the camera.

### 11.3 Export

Export **never reads canvas pixels**. `render/svg.ts` serializes the same layout output
to SVG: vector, resolution-independent, selectable text, clean printing.

- `toSVG()` returns a string.
- `toBlob({ format: 'png', scale: 3 })` redraws to an offscreen canvas at high DPI.
- `print()` writes the SVG into a hidden iframe and prints it.

Export always covers the whole **visible** tree, not the viewport. Collapsed branches
are excluded.

### 11.4 Accessibility

Canvas is invisible to screen readers, so a hidden but real DOM tree is rendered
alongside it: `role="tree"` / `role="treeitem"` with `aria-expanded` and `aria-level`.
It carries node names only, not full cards, and uses `content-visibility: auto`, so it
stays cheap at 50k nodes.

Keyboard: `ArrowUp`/`ArrowDown` move between rows, `Enter`/`Space` toggles, `Home` and
`End` jump to the ends. Moving focus tweens the camera to the focused node.

**Known gap.** `ArrowLeft`/`ArrowRight` are not bound. In the ARIA tree pattern they
collapse and expand the focused node, and their absence is a real accessibility
shortfall rather than a missing convenience. A `/` search shortcut was described here
before anything implemented it; it is not bound either, and belongs with the search UI
rather than with navigation.

## 11.6 Where this section is ahead of the code

Written before implementation, section 10's API listing and section 12's error table
describe a few things that were never built, and omit some that were. Rather than
quietly editing history, the differences are recorded here, because a design that
silently drifts into fiction stops being useful as a reference.

- `reparent()`, `toSVG()` / `toBlob()` / `print()`, and the `minimap` option are listed
  in section 10 but not yet in the public API. Export and the minimap now exist as pure
  computation in core; neither is wired to a public method yet. Reparenting is unbuilt.
- `animate` and `autoPanOnToggle` ship in the vanilla layer and are absent from
  section 10.
- Section 12 promises a distinct "no data" and single-node state. There is none: empty
  data produces an empty frame through the ordinary path, which is the simpler behaviour
  and appears to be the right one.

## 12. Error handling

| Condition | Behaviour |
|---|---|
| Worker fails to start (CSP, old browser) | Main-thread fallback using the same `Renderer`; silent degrade + `console.warn`. Tested separately. |
| Node with an unresolvable `parentId` | Treated as an orphan, collected under a separate root, emits `warning`. |
| Cycle in the input data (a→b→a) | Rejected at load, emits `warning` with the offending path. |
| Duplicate ids | Last one wins, emits `warning`. |
| Empty data / single node | Renders the `no-data` or single-card state; no layout run. |
| `reparent` producing a cycle | Rejected, returns `false`, event reports `prevented`. |

## 13. Toolchain

| Concern | Choice | Rationale |
|---|---|---|
| Workspace | pnpm workspaces | Strict `node_modules` surfaces cross-package boundary violations immediately. |
| Task runner | turbo | Topological ordering and caching; nx is oversized for four packages. |
| Versioning | changesets | Per-package semver, generated changelogs, publish from CI. |
| Build (publish) | tsdown (Rolldown) | `vite build --lib` produces oversized output; tsdown is what Vite's own lib mode is being rebuilt on. |
| Dev / demo | vite 8 | Rolldown is the default and only bundler as of Vite 8. |
| Types | vue-tsc for SFCs, tsdown native dts for core/react | — |
| TypeScript | **pinned 5.9.x / 6.x** | TS 7.0 is GA but `vue-tsc` cannot support it until TS 7.1 exposes the compiler API. Upgrading now breaks the build. |
| Vue peer range | `>=3.5 <4`, VDOM only | Vue 3.6 is still RC; Vapor Mode is feature-complete but not stable, and mixed Vapor/VDOM nesting has known rough edges for component libraries. |
| Test | vitest 4 browser mode + visual regression | Browser mode went stable in Vitest 4; jsdom canvas stubs are a dead end. |
| Lint / format | oxlint + prettier | Rust-based, same ecosystem as Rolldown. |
| Publish format | **ESM-only** | Half the output, no dual-package hazard, clean worker/OffscreenCanvas paths. |

## 14. Test strategy

**Unit (node, vitest).** Core is pure TS with no DOM, so it tests directly:
`tidy.ts` against known trees with expected coordinates, quadtree queries, viewport
matrix math, cycle detection, orphan handling, incremental relayout correctness
(dirty-subtree result must equal full-recompute result).

**Browser (vitest 4 browser mode).** Worker init, OffscreenCanvas rendering, hit-test
accuracy, pan/zoom pointer sequences, drag-drop, keyboard navigation, and the
main-thread fallback path with `worker: false`.

**Visual regression.** Five fixed fixtures (10 / 500 / 5,000 nodes × 4 orientations)
compared by pixel diff.

**Performance budget, enforced in CI.** 50k-node cold layout under 400ms; frame time
under 16ms at p95. Exceeding the budget fails the build.

## 15. Migration from v0.2.5

A `MIGRATION.md` covering:

| v0.2.5 | v1.0 |
|---|---|
| `<vue3-org-chart :data json minimap>` | `<Klados :options="{ data, nodeSize, ... }">` |
| `inject('api')` | `useKlados()` composable / `ref` on the component |
| `#node` scoped slot | `#node` scoped slot (same name, `NodeContext` shape) |
| CSS variables for lines | `theme` option (canvas tokens) + CSS vars for the overlay |
| `panzoom` behaviour | in-house viewport, same gestures |
| implicit node sizing | **required** `nodeSize` |

The existing `vue3-org-chart` npm package is not renamed or transferred. It receives one
final release whose README points at `@klados/vue` and links `MIGRATION.md`,
then stops receiving updates. The GitHub repository is already renamed to
`n1crack/orgchart`.

### 11.5 Minimap

Included in v1.0. The worker owns a second `OffscreenCanvas` and redraws the same
layout at a scale that fits the full tree bounds, using the lowest LOD tier
(rectangles and connectors, no text). It redraws only when the layout changes, not
per frame — the viewport rectangle on top is a cheap CSS-transformed overlay driven
by the camera.

Clicking or dragging inside the minimap moves the camera. Enabled via
`minimap?: boolean | { width, height, position }`, default off.

**Silhouette, not a shrunken chart.** At minimap scale an org chart of any real size
reduces to noise — individual boxes land on a fraction of a pixel and connectors
disappear entirely. What is actually useful at that size is the *shape* of the tree:
where the mass is, how deep it goes, and where the viewport sits within it. So the
minimap draws a filled silhouette of the occupied area — the union of the node boxes,
softened — rather than an accurate miniature. Reading it should answer "where am I and
what is over there", which is the only question a minimap is ever asked.

**It must not cost per frame.** The silhouette changes only when the layout changes,
so it is rasterized once per relayout and then blitted; only the viewport rectangle
tracks the camera, and that is a transform on an already-drawn image. A minimap that
re-renders 50,000 nodes every frame would cost more than the chart it summarises.

## 16. Deferred to later versions

- React adapter — spec 2, immediately after the API is frozen by the Vue adapter.
- Svelte adapter — decision deferred; must not constrain this design.
- WebGPU renderer backend — the `Renderer` interface leaves room; no work in v1.0.
- Animation easing curves and durations ship as fixed defaults in v1.0; exposing them
  as options is a follow-up if users ask.
