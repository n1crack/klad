---
title: Options
description: 'Every option createKlad takes: data, layouts, node size, labels, spacing, minimap, selection, drag and drop, theming and worker mode.'
---

# Options

The object passed to `createKlad` (or the `options` prop on the Vue and
React components). Only `data` is required — everything below has a default
that produces a usable chart.

## Data

| Option | Type | Default | |
|---|---|---|---|
| `data` | `NodeData[]` | — | Flat array. Every item is `{ id, parentId?, ...yours }`; an unresolvable `parentId` makes a root and emits a `warning`. |
| `nodeSize` | `Size \| (item) => Size` | `{ w: 180, h: 64 }` | The box each node occupies. Declared, never measured — see [Sizing](/guide/sizing). Exported as `DEFAULT_NODE_SIZE`. |
| `label` | `(item) => string` | `name` → `label` → `title` → `id` | The text the **canvas** draws inside a node, independent of whatever your card renders. Return `''` for a node that should stay blank. |

## Layout

The shape the tree is drawn in, and the knobs that tune it. All of these can
also be changed after construction with
[`setLayoutOptions`](/api/chart#layout) — see [Layouts](/guide/layouts) for
what each shape is for.

| Option | Type | Default | |
|---|---|---|---|
| `layout` | `'tidy' \| 'file' \| 'radial' \| 'sunburst'` | `'tidy'` | Which shape. `tidy` is the tiered chart; `file` indented rows; `radial` concentric rings; `sunburst` nested arcs. |
| `layoutStep` | `number` | derived | The per-level step, whose meaning is per-layout: the `file` indent, the `radial`/`sunburst` ring size. Omitted, each layout derives one from your `nodeSize`. |
| `rowGap` | `number` | `spacing.y` | `file` only: the gap between consecutive rows. |
| `maxRings` | `number` | `3` | `sunburst` only: how many rings are drawn around the centre. Deeper nodes are still there — drilling in reveals them. |
| `centre` | `string \| null` | `null` | `sunburst` only: the id at the middle of the wheel. Changing it animates; see [`setCentre`](/api/chart#layout). |
| `colourBranches` | `boolean` | per-layout | Fill nodes by which top-level branch they belong to, from `theme.palette`. On for `sunburst`, off elsewhere. |
| `orientation` | `'tb' \| 'bt' \| 'lr' \| 'rl'` | `'tb'` | Which way the tree grows. **`tidy` only** — a file list is a vertical list of rows whatever you set, and a wheel has no reading direction. |
| `rtl` | `boolean` | `false` | Mirrors sibling order; the growth direction is unaffected. |
| `spacing` | `{ x?, y?: number }` | `{ x: 16, y: 48 }` | Gaps between siblings and between levels, in world units. |
| `collapsedByDefault` | `boolean \| (item) => boolean` | `false` | Which nodes start closed. |

## Content

| Option | Type | Default | |
|---|---|---|---|
| `renderNode` | `(element, context) => void` | — | Draws your own card. See [Node content](/guide/node-content). Vue and React use the `#node` slot and the render prop instead. |
| `lodThresholds` | `{ block: number; label: number }` | `{ block: 0.25, label: 0.6 }` | The zoom levels at which the canvas switches between a plain shape, a labelled box, and overlay cards. |

## Appearance

| Option | Type | Default | |
|---|---|---|---|
| `theme` | `Partial<Theme>` | — | Colours and weights the canvas draws with. See [Theme](/api/theme). |
| `minimap` | `boolean \| MinimapOptions` | `false` | `{ position, width, height, silhouetteColour }`. `silhouetteColour` is the one piece your own CSS cannot restyle — set it for a dark host. |
| `zoomLimits` | `{ minK, maxK: number }` | `{ minK: 0.05, maxK: 4 }` | The floor is lowered automatically — never raised — when the tree is wider than the viewport, so `fit()` can always show everything. |

## Behaviour

| Option | Type | Default | |
|---|---|---|---|
| `maxChildren` | `number \| ((item) => number)` | — | How many children a node draws before the rest are rolled into one node saying how many it stands for. Per parent. See [Very wide levels](/guide/wide-levels). |
| `pinChildren` | `(item) => boolean` | — | Children shown whatever the cap says — your working set. Pins precede the budget rather than being part of it. |
| `mayHaveChildren` | `(item) => boolean` | — | Whether a node has children, whether or not they are in `data` yet. Only consulted for nodes with none; ignored without `loadChildren`. See [Children on demand](/guide/children-on-demand). |
| `loadChildren` | `(item) => NodeData[] \| Promise<NodeData[]>` | — | Fetches one node's children the first time it is opened. The chart keeps what you return. |
| `dragAndDrop` | `boolean` | `false` | Dragging a node — or the whole selection, if it is in one — onto a new parent, or between two siblings. Reported through [`nodeDrop`](/api/events) before it is applied. See [Drag and drop](/guide/drag-and-drop). |
| `selection` | `boolean` | `false` | Selecting nodes with the pointer — click, ctrl/cmd-click, shift-click, shift-drag for a box, alt-drag for a lasso. `select()` and `selectionChange` work either way; this is only about the pointer. |
| `keyboard` | `boolean` | `true` | Camera control from the keyboard, and the tab stop that makes the chart reachable at all — see [Navigating](/guide/navigating#keyboard). |
| `animate` | `boolean` | `true` | Every animation this layer starts on its own: the expand/collapse transition, camera eases, kinetic panning. `prefers-reduced-motion: reduce` forces it off regardless. |
| `autoPanOnToggle` | `boolean` | `true` | Keeps the toggled node pinned on screen while the layout moves around it. |
| `ring` | `boolean` | `true` | The one-shot confirmation flash after a single-node toggle. |
| `toggleOnNodeClick` | `boolean` | `false` | Tapping a node's body expands or collapses it. For cards with no room for a toggle button. |
| `worker` | `boolean` | `true` | Renders in a Web Worker. Falls back to the main thread on its own — a CSP that blocks workers, a canvas whose context was already taken — with a warning, never a failure. |

## Types

```ts
type NodeData = { id: string; parentId?: string | null; [key: string]: unknown }
type Size = { w: number; h: number }
type Orientation = 'tb' | 'bt' | 'lr' | 'rl'
type Camera = { x: number; y: number; k: number }
```

`NodeData`, `Size`, `Orientation`, `Camera`, `Bounds`, `Theme`,
`LodThresholds`, `ZoomLimits` and `Warning` are all re-exported from the
binding you installed — you never have to reach past it into the core to name
something it already hands you.
