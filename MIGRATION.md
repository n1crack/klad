# Migrating from `vue3-org-chart` v0.2.5 to v1.0

v1.0 is not a drop-in upgrade. It shares no code with v0.2.5 — the rendering
engine changed from recursive DOM components to canvas-in-a-worker, and the
package itself was split into three. This guide covers the mapping end to
end; read [README.md](README.md) first if you haven't already, since it
explains *why* several of these changes exist (in particular `nodeSize`).

The old `vue3-org-chart` npm package is not being renamed or transferred. It
will receive one final release whose README points here, then stop receiving
updates. The GitHub repository has already been renamed to `n1crack/orgchart`.

## What's not a drop-in, at a glance

- **The package name changed, and split into three.** `vue3-org-chart` is
  gone; there is no single package with that name to `npm install` an upgrade
  into. See [Packages](#packages) below.
- **`nodeSize` is newly required.** v0.2.5 let the DOM measure each node's
  rendered size for you. v1.0's layout runs in a Web Worker with no DOM, so
  you must declare every node's size (or a function that returns one) up
  front. This is the single most common thing that will make an existing
  chart fail to compile/run after upgrading — see the README's
  ["`nodeSize` is required"](README.md#nodesize-is-required-and-declarative--heres-the-trade)
  section for the reasoning.
- **The component API surface is different.** New prop shape, new slot
  context shape, new injection API. See the sections below.
- **The minimap is gone, for now.** v0.2.5 shipped an opt-in minimap
  (`<Vue3OrgChart minimap>`). v1.0's design includes one but it is not built
  yet. If your chart depends on it, stay on v0.2.5 until it ships.
- **Nothing else it did is gone permanently** — drag-and-drop reparenting,
  vector export, and a React adapter are all designed for v1.0 and in
  progress; they just aren't in this alpha. See the README's
  ["Not yet available"](README.md#not-yet-available) section.

## Packages

| v0.2.5 | v1.0 |
|---|---|
| `vue3-org-chart` (one package) | `@n1crack/orgchart-core` (pure logic, no DOM) + `@n1crack/orgchart` (frameworkless DOM binding) + `@n1crack/orgchart-vue` (Vue adapter) |

For a Vue app, install `@n1crack/orgchart-vue` only — it depends on
`@n1crack/orgchart`, which depends on `@n1crack/orgchart-core`, so one
`npm install` brings in the whole stack (all real `dependencies`, not
peers, apart from Vue itself).

```diff
- npm install vue3-org-chart
+ npm install @n1crack/orgchart-vue
```

There is no build-output CSS to import anymore — see
[Styling](#styling-css-variables--theme) below.

```diff
- import 'vue3-org-chart/dist/style.css'
```

## Registering the component

v0.2.5 registered a component named `Vue3OrgChart` (used in templates as
`<vue3-org-chart>` or `<Vue3OrgChart>`); v1.0's plugin registers one named
`OrgChart` instead (the plugin export itself keeps its old name,
`Vue3OrgChartPlugin`, for continuity).

```diff
  import { createApp } from 'vue'
- import { Vue3OrgChartPlugin } from 'vue3-org-chart'
+ import { Vue3OrgChartPlugin } from '@n1crack/orgchart-vue'

  const app = createApp(App)
  app.use(Vue3OrgChartPlugin)
```

```diff
- <vue3-org-chart :data="data">
+ <OrgChart :options="options">
```

Or skip the plugin and import the component directly, as before:

```diff
- import { Vue3OrgChart } from 'vue3-org-chart'
+ import { OrgChart } from '@n1crack/orgchart-vue'
```

## Props: `data`/`json`/`minimap` → one `options` object

v0.2.5 took loose top-level props:

```ts
// v0.2.5
interface IProps {
  data?: IData         // IData = Array<{ id, parentId?, __open? }>
  json?: string          // URL fetched on mount, same shape as `data`
  minimap?: boolean
}
```

v1.0 takes a single `options` prop (the same `Options` type the frameworkless
API takes):

```diff
  <script setup lang="ts">
+ import type { Options } from '@n1crack/orgchart-vue'
+
+ const options: Options = {
+   data: myData,               // same flat { id, parentId? } shape as before
+   nodeSize: { w: 180, h: 64 }, // NEW — required, see the README
+   label: (item) => String(item.name ?? ''),
+ }
  </script>

- <vue3-org-chart :data="myData">
+ <OrgChart :options="options">
```

The underlying data shape didn't actually change much — v0.2.5's `INode` was
already `{ id: string; parentId?: string }` plus an internal `__open` flag
the library managed for you. v1.0's `NodeData` is `{ id: string; parentId?:
string | null; ...yourOwnFields }`; initial open/closed state is now driven
declaratively by `collapsedByDefault` instead of a field on each node.

There is no `json` prop anymore — v1.0 never fetches on your behalf. If you
were relying on it, fetch the data yourself and pass the resulting array as
`options.data`:

```ts
const data = await fetch(url).then((r) => r.json())
const options: Options = { data, nodeSize: { w: 180, h: 64 } }
```

There is no `minimap` prop — see [What's not a drop-in](#whats-not-a-drop-in-at-a-glance).

## The `#node` scoped slot

Same slot name, different context shape:

```diff
  <template #node="{
-   item, children, open, toggleChildren
+   item, hasChildren, open, toggle
  }">
    <div>{{ item.name }}</div>
-   <button v-if="children.length" @click="toggleChildren">
+   <button v-if="hasChildren" @click="toggle">
      {{ open ? '-' : '+' }}
    </button>
  </template>
```

`children` (the array of child data objects) became `hasChildren` (a plain
boolean) — the overlay only ever needs to know whether a toggle button
should render, not the child list itself, and computing it as a boolean is
far cheaper at scale. If your template used `children` for something other
than a length check, that data isn't available in the slot context, though
it's the same data reachable from your own `options.data` array.

`toggleChildren` was renamed `toggle`, same behavior (still a zero-arg
callback that flips the node's own expand/collapse state).

## Reaching the API: `inject('api')` → `useOrgChart()` / `ref`

v0.2.5 provided its API object under the string key `'api'`:

```ts
// v0.2.5
import { inject } from 'vue'
const api = inject('api') // { zoomReset, zoomIn, zoomOut, expandAll,
                            //   collapseAll, root, rootId, find,
                            //   findChildren, goToHome, minimap, $root }
```

v1.0 exposes a typed composable instead, returning both the API and a
reactive state snapshot:

```ts
// v1.0
import { useOrgChart } from '@n1crack/orgchart-vue'
const { api, state } = useOrgChart() // both shallowRef; api.value: OrgChartApi | null
```

Or, if you hold a template `ref` on `<OrgChart>` directly, its exposed
`.api` is the same object:

```vue
<script setup lang="ts">
import { ref } from 'vue'
const chartRef = ref<{ api: import('@n1crack/orgchart-vue').OrgChartApi | null } | null>(null)
</script>
<template>
  <OrgChart ref="chartRef" :options="options" />
</template>
```

Method-by-method:

| v0.2.5 `api.*` | v1.0 `api.*` | Notes |
|---|---|---|
| `zoomReset()` | `reset()` (alias for `fit()`) | |
| `zoomIn()` / `zoomOut()` | `zoomIn()` / `zoomOut()` | Same names. |
| `expandAll()` / `collapseAll()` | `expandAll()` / `collapseAll()` | Same names; v1.0 also re-fits the camera afterward unless `autoPanOnToggle: false`. |
| `root()` / `rootId()` | *(no equivalent)* | Read the first entry of your own `options.data` with no `parentId`, or use `search()`. |
| `find(id)` | *(no equivalent)* | Look the node up in your own `data` array (you already have it — `NodeData` isn't hidden from you). |
| `findChildren(id)` | *(no equivalent)* | Filter your own `data` array by `parentId`. |
| `goToHome(element)` | `focus(id)` | Expands the ancestor chain and centres the camera on a node by id, rather than a raw DOM element. |
| `minimap.state` / `.toggle()` | *(not implemented yet)* | See [What's not a drop-in](#whats-not-a-drop-in-at-a-glance). |
| *(none)* | `zoomTo(k)` | New: jump to an exact zoom level. |
| *(none)* | `expand(id, deep?)` / `collapse(id, deep?)` / `expandTo(id)` | New: per-node control, not just all-or-nothing. |
| *(none)* | `search(query)` / `highlight(ids)` | New: linear-scan search returning ancestor paths, plus canvas highlight colouring. |
| *(none)* | `getState()` | New: `{ nodeCount, visibleCount, camera, bounds, rootScreenCentre }` snapshot, also delivered continuously via `subscribe`/`useOrgChart().state`. |

`$root` (a `Ref<HTMLElement | null>` to the root node's DOM element) has no
equivalent — there is no guaranteed DOM element per node anymore, since most
nodes at most zoom levels have none. Use `focus(id)` to bring a node into
view instead of reaching for its element directly.

## Styling: CSS variables → `theme` option

v0.2.5 styled the connector lines and container via CSS custom properties on
a stylesheet you had to import:

```css
:root {
  --vue3-org-chart-container-height: 70vh;
  --vue3-org-chart-line-top: 0.5rem;
  --vue3-org-chart-line-bottom: 0.5rem;
  --vue3-org-chart-node-space-x: 0.5rem;
  --vue3-org-chart-line-color: blue;
}
```

None of those variables exist in v1.0 — there is no stylesheet to import at
all, and the connectors and node boxes are drawn on canvas, not CSS. The
equivalent controls are:

- **Connector/box colours, corner radius, label font** → the `theme` option
  (`Partial<Theme>`, canvas drawing tokens: `edgeStroke`, `edgeWidth`,
  `nodeFill`, `nodeStroke`, `cornerRadius`, `labelColour`, `labelFont`, etc.)
- **Spacing between nodes** → `spacing: { x, y }` (was
  `--vue3-org-chart-node-space-x`/the line-top/bottom variables)
- **Container size** → your own CSS on whatever element hosts `<OrgChart>` or
  the `host` element you pass to `createOrgChart` (was
  `--vue3-org-chart-container-height`)
- **Card appearance** (background, border, text inside a card) → ordinary CSS
  on the elements your own `#node` slot / `renderNode` callback renders. This
  part is *more* capable than before, not less: it's just plain DOM you fully
  own, the same as it was in v0.2.5's default slot content.

## Pan/zoom behaviour

v0.2.5 delegated pan/zoom to the third-party `panzoom` package. v1.0 replaces
it with an in-house viewport (`@n1crack/orgchart-core`'s `viewport.ts`) — the
gestures are the same shape (drag to pan, wheel/pinch to zoom at the pointer)
plus kinetic momentum on release, which `panzoom` didn't do. There is no
`panzoom` instance to reach into anymore; use the `OrgChartApi` methods
(`zoomTo`, `zoomIn`, `zoomOut`, `fit`, `focus`) instead of `panzoomInstance`
methods.

## Orientation and RTL — new, not a migration concern

v0.2.5 only ever laid out top-to-bottom. v1.0 adds `orientation: 'tb' | 'bt'
| 'lr' | 'rl'` and an independent `rtl: boolean` for mirroring sibling order.
Nothing to change here unless you want the new layouts.

## Full example, before and after

```vue
<!-- v0.2.5 -->
<script setup lang="ts">
import { inject } from 'vue'
const api = inject('api')
</script>
<template>
  <vue3-org-chart :data="data">
    <template #node="{ item, children, open, toggleChildren }">
      <div class="card">
        <div>{{ item.name }}</div>
        <button v-if="children.length" @click="toggleChildren">
          {{ open ? '-' : '+' }}
        </button>
      </div>
    </template>
  </vue3-org-chart>
</template>
```

```vue
<!-- v1.0 -->
<script setup lang="ts">
import { OrgChart, useOrgChart } from '@n1crack/orgchart-vue'
import type { Options } from '@n1crack/orgchart-vue'

const options: Options = {
  data,
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
}

const { api } = useOrgChart()
</script>
<template>
  <OrgChart :options="options" style="width: 100%; height: 70vh">
    <template #node="{ item, hasChildren, open, toggle }">
      <div class="card">
        <div>{{ item.name }}</div>
        <button v-if="hasChildren" @click="toggle">
          {{ open ? '-' : '+' }}
        </button>
      </div>
    </template>
  </OrgChart>
</template>
```

## If you get stuck

Compare against `packages/playground/src/VueDemo.vue` and
`packages/playground/src/data.ts` in this repository — they're exercised by
the test suite and cover orientation, RTL, variable node sizes, collapsed
defaults, and five different card layouts, so they're guaranteed to reflect
the current API.
