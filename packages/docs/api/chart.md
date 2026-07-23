# Chart API

The imperative handle. `createKlados` returns an instance whose `.api` is
this; in Vue reach it with `useKlados()` or a `ref` on the component, in
React with a `ref` on `<Klados>`.

::: tabs key:stack

== Vanilla

```ts
const chart = createKlados(host, options)
chart.api.fit()
```

== Vue

```vue
<script setup lang="ts">
import { useKlados } from '@klados/vue'

const { api, state } = useKlados() // both shallowRefs
api.value?.fit()
</script>
```

== React

```tsx
const chartRef = useRef<KladosHandle>(null)
// ...
chartRef.current?.api?.fit()
```

:::

## Camera

| Method | |
|---|---|
| `fit()` | Zoom out to show the whole visible tree. |
| `reset()` | Back to the opening view. |
| `zoomIn()` / `zoomOut()` | One step about the viewport centre. |
| `zoomTo(k)` | An exact scale, within `zoomLimits`. |
| `focus(id, opts?)` | Centre a node, opening every collapsed ancestor on the way. `{ ring: true }` flashes the confirmation ring on arrival. |

## Tree

| Method | |
|---|---|
| `expand(id, deep?)` | Open a node, or its whole subtree. |
| `collapse(id, deep?)` | Close it. |
| `expandAll()` / `collapseAll()` | Everything. |
| `expandTo(id)` | Open the ancestors of a node without moving the camera. |
| `stats(id)` | `{ directChildren, descendants, depth, height }`, or `null`. Describes the whole tree, not the expanded part. |
| `pathTo(id)` | The root-to-node id chain, inclusive. `null` for an unknown id. |
| `refresh()` | Re-read every node's `nodeSize`/`label` and lay out again, keeping expand/collapse, camera and highlight. See [Sizing](/guide/sizing). |

## Finding and marking

| Method | |
|---|---|
| `search(query)` | Substring on the label, or your own `(item) => boolean`. Returns `{ id, item, path }[]`. |
| `highlight(ids \| null)` | Light those nodes, and the connectors between any two of them that are parent and child. |

## Export

| Method | |
|---|---|
| `toSVG(opts?)` | The whole visible tree as a standalone SVG string — real `<text>`, resolution-independent, never a screenshot of the current camera. |
| `toBlob({ format, scale? })` | `'png'` or `'jpeg'`, redrawn offscreen at `scale` DPI. Also a document, not a screen grab. |
| `print()` | The SVG, into a hidden iframe, printed. |

Both exports cover the visible tree regardless of where the camera happens to
be — collapsed branches are excluded, everything else is included.

## Live settings

These change one thing without the tree-state reset that going through
`update()` would cause:

| Method | |
|---|---|
| `setTheme(partial)` | Merged over the **current** theme, not the defaults. Paint-only: camera, expand state and scroll position are untouched, and a transition mid-flight keeps animating in the new colours. |
| `setMinimap(boolean \| options)` | On, off, moved or resized. |
| `setRing(boolean)` | The confirmation flash. An already-fading ring finishes rather than being cut off. |

## Instance

| Member | |
|---|---|
| `update(data, options?)` | Replace the data. Resets open state — use `refresh()` if all you did was change a size. |
| `subscribe(fn)` | Called with `ChartState` whenever it changes. Returns an unsubscribe. |
| `on(event, fn)` | See [Events](/api/events). Returns an unsubscribe. |
| `destroy()` | Removes everything it created and releases the worker. |

`ChartState` is `{ nodeCount, visibleCount, camera, bounds, rootScreenCentre }`.
