# Chart API

The imperative handle. `createKlad` returns an instance whose `.api` is
this; in Vue reach it with `useKlad()` or a `ref` on the component, in
React with a `ref` on `<Klad>`.

::: tabs key:stack

== Vanilla

```ts
const chart = createKlad(host, options)
chart.api.fit()
```

== Vue

```vue
<script setup lang="ts">
import { useKlad } from '@klad/vue'

const { api, state } = useKlad() // both shallowRefs
api.value?.fit()
</script>
```

== React

```tsx
const chartRef = useRef<KladHandle>(null)
// ...
chartRef.current?.api?.fit()
```

:::

## Camera

| Method | |
|---|---|
| `fit()` | Zoom out to show the whole visible tree. |
| `fitSubtree(id)` | Frame one branch instead — the smallest camera that shows `id` and everything visible below it. On a chart of thousands, "show me Engineering" is the question people actually have. |
| `isolate(id \| null)` | Show one branch **as** the chart: `id` becomes the root and everything else stops existing — for the layout, the minimap, the keyboard tree, search and export alike. `fitSubtree` points the camera; this changes what is there. |
| `reset()` | Back to the opening view. |
| `zoomIn()` / `zoomOut()` | One step about the viewport centre. |
| `zoomTo(k)` | An exact scale, within `zoomLimits`. |
| `focus(id, opts?)` | Centre a node, opening every collapsed ancestor on the way. `{ ring: true }` flashes the confirmation ring on arrival. |

### Saving where you are

```ts
const view = chart.api.getView()      // { camera, open, highlighted, isolated }
localStorage.setItem('chart', JSON.stringify(view))

chart.api.setView(JSON.parse(localStorage.getItem('chart')!))
chart.api.setView(view, { animate: true })   // fly there instead of arriving
```

A view is a plain serialisable object naming nodes by id, so it survives the
data being refetched, reordered or grown — put one in a URL and you have a
link to a place in a chart. Ids it names that are no longer in the tree are
ignored rather than throwing, which is what keeps an old bookmark usable.

## Selection

| Method | |
|---|---|
| `select(ids \| null)` | Set the selection. Unknown ids are ignored. |
| `getSelection()` | The current selection, in the order it was given. |

Selection is what the *viewer* picked; [`highlight`](#highlighting) is what the
*chart* is pointing at (a search hit, the route to a node). They co-occur —
select three people, then search — so they are drawn differently and stored
separately.

The `selectionChange` event carries the whole selection rather than a delta:

```ts
chart.on('selectionChange', ({ ids, items }) => console.log(ids.length, 'selected'))
```

Pointer selection is opt-in with [`selection: true`](/api/options): click to
select, ctrl/cmd-click to add or remove one, shift-click to add, shift-drag for
a box, alt-drag for a lasso, `Esc` to clear. It is off by default because a
chart written before this existed already has its own meaning for a click.

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
