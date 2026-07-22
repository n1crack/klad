# Options

The object passed to `createOrgChart` (or the `options` prop on the Vue and
React components). Only `data` and `nodeSize` are required.

## Data

| Option | Type | Default | |
|---|---|---|---|
| `data` | `NodeData[]` | — | Flat array. Every item is `{ id, parentId?, ...yours }`; an unresolvable `parentId` makes a root and emits a `warning`. |
| `nodeSize` | `Size \| (item) => Size` | — | Declared, never measured — see [Sizing](/guide/sizing). |
| `label` | `(item) => string` | `''` | The text the **canvas** draws inside a node. Independent of whatever your card renders. |

## Layout

| Option | Type | Default | |
|---|---|---|---|
| `orientation` | `'tb' \| 'bt' \| 'lr' \| 'rl'` | `'tb'` | Which way the tree grows. |
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
| `minimap` | `boolean \| MinimapOptions` | `false` | `{ position, width, height }`. |
| `zoomLimits` | `{ minK, maxK: number }` | `{ minK: 0.05, maxK: 4 }` | The floor is lowered automatically — never raised — when the tree is wider than the viewport, so `fit()` can always show everything. |

## Behaviour

| Option | Type | Default | |
|---|---|---|---|
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
