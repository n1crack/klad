# OrgChart

A framework-agnostic org chart library. It lays out and draws the tree on a
`<canvas>` inside a Web Worker, and overlays real framework components only
for the handful of nodes actually on screen and zoomed in far enough to read.

**The one number that matters:** it renders trees of 5,000–50,000 nodes at
60fps. A DOM-per-node chart cannot do this — 50,000 live component instances
plus 50,000 connector elements exhausts both memory and layout time long
before it gets there. This library never creates DOM for a node unless that
node is both visible and legible.

> **Status.** This is v1.0.0-alpha.0 of a ground-up rewrite. The vanilla and
> Vue packages are implemented and tested; a React adapter, drag-and-drop
> reparenting, export, and a minimap are designed but **not implemented yet**
> (see [Not yet available](#not-yet-available)).

## How it works, in one paragraph

`createOrgChart` builds the tree's layout and rasterizes it to a canvas whose
control is transferred to a Web Worker (`transferControlToOffscreen`). The
main thread keeps its own copy of a quadtree for hit-testing, so clicks and
hover never round-trip to the worker. Above a configurable zoom threshold, the
main thread also mounts real framework components — Vue templates, or plain
DOM in the frameworkless API — as an absolutely-positioned overlay for the
roughly 50 nodes currently in the viewport, regardless of how large the tree
is. Below that threshold, the canvas draws a plain box (and, at a second
threshold, a single truncated label line); no DOM exists for those nodes at
all.

## Packages

| Package | What it's for |
|---|---|
| [`@n1crack/orgchart`](packages/vanilla) | The frameworkless API. One function, `createOrgChart`. Use this directly, or as the reference for writing a new adapter. |
| [`@n1crack/orgchart-vue`](packages/vue) | Vue 3 binding: an `<OrgChart>` component with a `#node` scoped slot, plus a `useOrgChart()` composable. |
| [`@n1crack/orgchart-core`](packages/core) | Pure TypeScript layout, viewport math, spatial index, and worker protocol. No DOM. Depend on this directly only if you're building a new framework adapter. |

`@n1crack/orgchart` depends on `@n1crack/orgchart-core`; `@n1crack/orgchart-vue`
depends on `@n1crack/orgchart`. All are real `dependencies`, not peers (except
Vue itself), so installing one package is enough — you never need to also
install `@n1crack/orgchart` to use the Vue adapter.

A React adapter (`@n1crack/orgchart-react`) is designed but not built yet.

## Install

```bash
# frameworkless
npm install @n1crack/orgchart

# Vue 3 (>=3.5 <4)
npm install @n1crack/orgchart-vue

# building your own framework adapter
npm install @n1crack/orgchart-core
```

## Quick start — frameworkless

```ts
import { createOrgChart, type Options } from '@n1crack/orgchart'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
  nodeSize: { w: 180, h: 64 }, // required — see below
  label: (item) => String(item.name ?? ''),
  renderNode(element, context) {
    element.innerHTML = `
      <div class="card">
        <strong>${String(context.item.name ?? '')}</strong>
        <small>${String(context.item.title ?? '')}</small>
        ${context.hasChildren ? '<button class="toggle">±</button>' : ''}
      </div>
    `
    element.querySelector('.toggle')?.addEventListener('click', context.toggle)
  },
}

const chart = createOrgChart(document.getElementById('chart')!, options)

chart.on('nodeClick', ({ id, item }) => console.log('clicked', id, item))
// later: chart.destroy()
```

`data` is a flat array — every item is `{ id, parentId?, ...yourOwnFields }`.
There is no nested-children shape; parentage is expressed purely by
`parentId`, and a missing/unresolvable `parentId` makes a node a root (with a
`warning` event, see [Events](#events)).

## Quick start — Vue

```vue
<script setup lang="ts">
import { OrgChart } from '@n1crack/orgchart-vue'
import type { Options } from '@n1crack/orgchart-vue'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
}
</script>

<template>
  <OrgChart :options="options" style="width: 100%; height: 100vh">
    <template #node="{ item, hasChildren, open, toggle }">
      <div class="card">
        <strong>{{ String(item.name ?? '') }}</strong>
        <small>{{ String(item.title ?? '') }}</small>
        <button v-if="hasChildren" type="button" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>
    </template>
  </OrgChart>
</template>
```

Reach the imperative API from anywhere under `<OrgChart>` with the
`useOrgChart()` composable (`const { api, state } = useOrgChart()` — both are
`shallowRef`s), or from a `ref` on the component itself
(`chartRef.value.api`). A global-registration plugin is also exported:
`Vue3OrgChartPlugin` (name kept from the previous package), which registers
the component as `OrgChart`.

## Quick start — building on core

Most consumers should use `@n1crack/orgchart` or `@n1crack/orgchart-vue`
instead. `@n1crack/orgchart-core` is the pure-logic layer underneath both —
layout, viewport math, the quadtree, the Canvas2D renderer, and the worker
protocol — for anyone writing a new framework adapter. `packages/vanilla/src`
is the reference implementation to read.

```ts
import { normalize, layout, type NodeData } from '@n1crack/orgchart-core'

const data: NodeData[] = [
  { id: 'ceo' },
  { id: 'cto', parentId: 'ceo' },
  { id: 'cfo', parentId: 'ceo' },
]

const tree = normalize(data) // indices, parent/child maps, cycle/orphan detection

const sizes = new Float64Array(tree.count * 2)
for (let i = 0; i < tree.count; i++) {
  sizes[i * 2] = 180 // w
  sizes[i * 2 + 1] = 64 // h
}

const { boxes, bounds } = layout(tree, sizes, { spacingX: 16, spacingY: 48 })
// boxes is a flat [x, y, w, h, x, y, w, h, ...] array, one quad per node,
// indexed the same way as tree.indexToId.
```

`@n1crack/orgchart-core`'s DOM-touching module, `ChartHost`, is deliberately
**not** exported from the package's main entry — only from the `/host`
subpath (`@n1crack/orgchart-core/host`) — so the main entry stays importable
inside the Web Worker it also ships (`worker/chart.worker.ts`).

## `nodeSize` is required, and declarative — here's the trade

```ts
nodeSize: Size | ((item: NodeData) => Size)   // Size = { w: number; h: number }
```

Every other org-chart library that renders to the DOM can measure a node
after mounting it, then lay the tree out around whatever size it turned out
to be. This one cannot, and that's not an oversight — it's the same decision
that makes the 50k-node number possible.

Layout runs inside a Web Worker, which has no DOM. It cannot mount your Vue
template, read its `getBoundingClientRect()`, and only then decide where the
box goes — there is nothing to mount there. So `nodeSize` has to be supplied
up front, either as one fixed `{ w, h }` for every node or as a function of
the node's own data (see the `variable-sizes` playground example, which picks
one of three sizes per node). Content fits the box you declare; it does not
determine the box.

The alternative — auto-sizing from rendered content — was considered and
rejected: it requires mounting every node to the DOM once before layout can
run, which reinstates the exact per-node DOM cost this rework exists to
remove. If your card's content can overflow a fixed box, design the card to
truncate or wrap within it (the built-in label is truncated with an ellipsis
this way); the library will not grow the box to fit you.

## Options reference

| Option | Type | Default | Notes |
|---|---|---|---|
| `data` | `NodeData[]` | — | Required. Flat array, `{ id, parentId?, ...yourFields }`. |
| `nodeSize` | `Size \| (item) => Size` | — | Required. See above. |
| `label` | `(item) => string` | `() => ''` | Text drawn on canvas at the `label`/`full` LOD tiers, and the text used by `search()` and the accessibility mirror. |
| `orientation` | `'tb' \| 'bt' \| 'lr' \| 'rl'` | `'tb'` | Growth direction: top-down, bottom-up, left-right, right-left. |
| `rtl` | `boolean` | `false` | Mirrors sibling order independently of `orientation` — growth direction and reading direction are separate axes. |
| `spacing` | `{ x?: number; y?: number }` | `{ x: 16, y: 48 }` | Minimum gap between sibling boxes / between a parent and its children. |
| `lodThresholds` | `{ text: number; overlay: number }` | `{ text: 0.25, overlay: 0.6 }` | Zoom (`camera.k`) at which labels start drawing, and at which the DOM overlay activates. |
| `collapsedByDefault` | `boolean \| (item) => boolean` | `false` (all open) | Initial `open` state per node. |
| `theme` | `Partial<Theme>` | see `DEFAULT_THEME` | Canvas drawing tokens: fill/stroke colours, corner radius, edge stroke, label font/colour, highlight colours, drag-ghost alpha, toggle-ring colour. Does **not** style overlay card content — that's your own CSS. |
| `zoomLimits` | `{ minK: number; maxK: number }` | `{ minK: 0.05, maxK: 4 }` | The floor is lowered automatically (never raised) when a chart is wider than the viewport, so `fit()` can still show everything. |
| `worker` | `boolean` | `true` | Set `false` to force main-thread rendering (useful under a CSP that blocks worker scripts, or in tests). Automatically falls back to `false`'s behaviour if a worker can't start, regardless of this setting. |
| `renderNode` | `(el: HTMLElement, ctx: NodeContext) => void` | — | Frameworkless-only. Framework adapters supply this for you from their own slot/template mechanism. |
| `animate` | `boolean` | `true` | Governs every camera animation this layer initiates on its own (the `focus`/`fit`/`reset`/`zoomTo`/`zoomIn`/`zoomOut` ease, auto-pan-on-toggle, kinetic pan momentum). Forced to `false` automatically when the OS reports `prefers-reduced-motion: reduce`. `false` makes the camera still move, just instantaneously. |
| `autoPanOnToggle` | `boolean` | `true` | After a single-node `expand`/`collapse`, tweens the camera to frame the toggled node (and its newly-revealed children, on expand). Never re-fits the whole chart and never zooms in past 1:1. `expandAll`/`collapseAll` always `fit()` instead, regardless of this option. |

`NodeContext`, passed to `renderNode` and to the Vue `#node` slot:

```ts
interface NodeContext {
  id: string
  item: NodeData
  open: boolean
  hasChildren: boolean
  toggle(): void
}
```

## API reference

`createOrgChart(host, options)` returns an `OrgChartInstance`:

| Member | Signature | Notes |
|---|---|---|
| `destroy` | `(): void` | Tears down the worker, canvas, overlay, input listeners, and accessibility mirror. |
| `update` | `(data: NodeData[], options?: Partial<Options>): void` | Reloads data and/or merges new options. Resets open/collapsed state per `collapsedByDefault`. |
| `subscribe` | `(cb: (state: ChartState) => void): () => void` | Called after every render with the current `ChartState`. Returns an unsubscribe function. |
| `on` | `(event, cb): () => void` | See [Events](#events). Returns an unsubscribe function. |
| `api` | `OrgChartApi` | The imperative surface below. |

`OrgChartApi`:

| Method | Signature | Notes |
|---|---|---|
| `zoomTo` | `(k: number): void` | Animated (subject to `animate`), anchored on the viewport centre. |
| `zoomIn` / `zoomOut` | `(): void` | `zoomTo(camera.k * 1.25)` / `/ 1.25`. |
| `fit` | `(): void` | Frames the whole tree with padding. |
| `reset` | `(): void` | Currently an alias for `fit()`. |
| `focus` | `(id: string): void` | Expands the ancestor chain to `id` (via `expandTo`) and centres the camera on it at the current zoom. |
| `expand` / `collapse` | `(id: string, deep?: boolean): void` | `deep` recurses through descendants. Single-node calls (deep `false`, the default) trigger `autoPanOnToggle`. |
| `expandAll` / `collapseAll` | `(): void` | Whole-tree toggle; always followed by `fit()` unless `autoPanOnToggle` is `false`. |
| `expandTo` | `(id: string): void` | Opens every ancestor of `id` without touching `id`'s own open state. |
| `search` | `(query: string \| (item) => boolean): SearchResult[]` | Linear scan; string form matches case-insensitively against `label`. Returns `{ id, item, path }[]`. |
| `highlight` | `(ids: string[] \| null): void` | Recolours the given nodes on canvas (`theme.highlightFill`/`highlightStroke`); `null` clears it. |
| `getState` | `(): ChartState` | Snapshot — same shape delivered to `subscribe`. |

`ChartState`:

```ts
interface ChartState {
  nodeCount: number        // total nodes in the tree
  visibleCount: number      // nodes surviving collapse-pruning (not the same as on-screen)
  camera: Camera             // { x, y, k }
  bounds: Bounds              // world-space bounding box of the laid-out tree
  rootScreenCentre: { x: number; y: number } // screen-space centre of the first root
}
```

## Events

Subscribe with `chart.on('eventName', callback)`; every call returns an
unsubscribe function.

| Event | Payload | Fires when |
|---|---|---|
| `nodeClick` | `{ id, item }` | A tap/click lands on a node (canvas hit-test). |
| `nodeDblClick` | `{ id, item }` | Two taps on the same node inside the platform double-click window (300ms). The second tap does not also emit `nodeClick`. |
| `nodeHover` | `{ id, item } \| { id: null, item: null }` | Pointer enters a node, or leaves all nodes (including bare canvas). Never fires twice in a row for the same id. |
| `toggle` | `{ id, open }` | A node's expand/collapse state changes (single-node only, not `expandAll`/`collapseAll`). |
| `viewportChange` | `{ camera }` | The camera moves, for any reason (input, animation, `fit`, etc.). |
| `warning` | `Warning` (`{ code, detail, ids }`) | On data load: `'duplicate-id'`, `'orphan-parent'`, or `'cycle'`. Fired once per issue, after `createOrgChart`/`update` returns. |
| `ready` | — | Fired once, on the microtask after the chart first initializes. |

## Accessibility

Canvas is invisible to screen readers and keyboard focus, so the chart
maintains a real, hidden DOM tree alongside it: `role="tree"` /
`role="treeitem"` rows, one per node, with `aria-expanded` and `aria-level`
kept in sync. Rows are visually hidden by clipping (not `display: none`,
which would also remove them from the accessibility tree) and use
`content-visibility: auto`, so a 50,000-node mirror stays cheap.

Keyboard support in that mirror:

| Key | Effect |
|---|---|
| `↑` / `↓` | Move focus to the previous/next row in document order. |
| `Enter` / `Space` | Toggle the focused row's expand/collapse state. |
| `Home` / `End` | Jump to the first / last row. |

Moving focus pans the camera to the newly-focused node (via `focus()`,
subject to `animate`).

This is a real, if focused, accessibility layer — most canvas-based chart
libraries expose nothing to assistive technology at all. It currently covers
navigation and structure (names, level, expanded state); there is no
left/right arrow re-parenting of focus by depth, and no in-chart search
shortcut yet.

## Browser support and degradation

The chart prefers to run its layout and rendering inside a Web Worker via
`OffscreenCanvas` + `transferControlToOffscreen()`. If that fails for any
reason — a CSP that blocks worker scripts, a browser without
`OffscreenCanvas`, or a canvas whose 2D context was already claimed — it
falls back automatically to rendering the same `Renderer` on the main thread,
with a `console.warn` explaining why. Nothing else about the API changes:
same options, same events, same `OrgChartApi`. Pass `worker: false` to force
main-thread rendering yourself (useful in tests, or under a CSP you don't
control).

Requires a browser with `Worker`, `OffscreenCanvas`, `ResizeObserver`, and
`Canvas2D` support (all current evergreen browsers). Published as ESM only.

## Not yet available

The following are part of the v1.0 design but are still in progress, worked
on in parallel with this documentation. They are intentionally absent from
`Options`/`OrgChartApi` above rather than half-implemented:

- **Drag-and-drop reparenting** (`api.reparent()`, a `reparent` event).
- **Export** (`toSVG()`, `toBlob()`, `print()`).
- **Minimap** (`minimap` option).
- **React adapter** (`@n1crack/orgchart-react`).

## Development

This is a pnpm workspace (`pnpm@10.13.1`, Node `>=22.12.0`).

```bash
pnpm install
pnpm test         # 303 tests across core/vanilla/vue (vitest, incl. browser mode)
pnpm typecheck
pnpm lint
```

`packages/playground` is a Vite app with every example referenced above (plus
orientation, RTL, five card treatments, and a 20,000-node stress test) —
run `pnpm --filter @n1crack/orgchart-playground dev` to try them live.

## License

MIT, © Yusuf Özdemir. See [LICENSE](LICENSE).
