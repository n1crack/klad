---
title: Chart API
description: 'The imperative handle: expand and collapse, camera commands, search, selection, layout tuning, views and SVG or PNG export.'
---

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
| `isolate(id \| null)` | Show one branch **as** the chart: `id` becomes the root and everything else stops existing — for the layout, the minimap, the keyboard tree and export alike. `fitSubtree` points the camera; this changes what is there. |
| `reset()` | Back to the opening view. |
| `zoomIn()` / `zoomOut()` | One step about the viewport centre. |
| `zoomTo(k)` | An exact scale, within `zoomLimits`. |
| `focus(id, opts?)` | Centre a node, opening every collapsed ancestor on the way. `{ ring: true }` flashes the confirmation ring on arrival. |

### Saving where you are

```ts
// { camera, open, highlighted, isolated, selected, filter, uncapped, revealed }
const view = chart.api.getView()
localStorage.setItem('chart', JSON.stringify(view))

chart.api.setView(JSON.parse(localStorage.getItem('chart')!))
chart.api.setView(view, { animate: true })   // fly there instead of arriving
```

A view is a plain serialisable object naming nodes by id, so it survives the
data being refetched, reordered or grown — put one in a URL and you have a
link to a place in a chart. One exception, and it is stated rather than
rounded: a [`filter`](#searching-and-filtering-are-different-things) set with a
predicate cannot be written into a URL, so `getView` reports `filter: null` for
one and a restored view shows the whole tree. Ids it names that are no longer in the tree are
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
| `stats(id)` | `{ directChildren, descendants, depth, height, lft, rgt }`, or `null`. Describes the whole tree, not the expanded part. |
| `pathTo(id)` | The root-to-node id chain, inclusive. `null` for an unknown id. |
| `showMore(id)` | Lift the cap on the parent an aggregate node belongs to. `id` is the aggregate node's own. See [Very wide levels](/guide/wide-levels). |
| `reveal(ids)` | Bring specific children back past a cap without lifting it. |
| `refresh()` | Re-read every node's `nodeSize`/`label` and lay out again, keeping expand/collapse, camera and highlight. See [Sizing](/guide/sizing). |

### Is this node inside that branch?

`lft` and `rgt` are nested-set bounds: a node's pair brackets every pair below
it. That turns an ancestor walk of unbounded length into two comparisons —

```ts
const branch = chart.api.stats('engineering')!
const node = chart.api.stats('lead-42')!
const inside = node.lft > branch.lft && node.rgt < branch.rgt
```

— which is what makes filtering a large tree by branch cheap enough to do per
frame. Strict on both sides, so a node is not inside itself, and `rgt - lft` is
`2 * descendants + 1`, so the pair carries the subtree size too.

It is the classic interleaved numbering rather than a half-open range, because
that is also what a database storing a hierarchy as nested sets uses — so these
can go straight back after a drag reorders anything. Numbered across the whole
forest, so two roots' ranges never overlap.

Every number describes the full tree, not the expanded part, and all six are
also on the context every card is rendered with — see [Node content](/guide/node-content).
The counts leave out the nodes a [capped level](/guide/wide-levels) invents;
`lft`/`rgt`, being positions rather than counts, include them.

## Finding and marking

| Method | |
|---|---|
| `search(query)` | Substring on the label, or your own `(item) => boolean`. Returns `{ id, item, path }[]`. Scans the whole tree; changes nothing. |
| `filter(query \| null)` | Reduce the chart to the matches and the ancestors that lead to them. Returns the ids that matched. See [Filtering](/guide/filtering). |
| `highlight(ids \| null)` | Light those nodes, and the connectors between any two of them that are parent and child. |

### Searching and filtering are different things

`search` is a **query**: it scans the whole tree — including branches that are
collapsed, isolated away, or removed by a filter — and changes nothing. That is
what makes it the thing the other commands are built from. "Is there a Rossi
anywhere in this company" is not a question about the current view, and a search
that could only find what was already on screen would be no use for getting to
what is not.

`filter` is a **command**: it changes what the chart is.

```ts
const found = chart.api.filter('schema')   // ['src/lib/schema.ts', 'src/db/schema-utils.ts']
chart.api.filter(null)                     // back to the whole tree
```

What stays is the matches plus the ancestors that lead to them — so the result
is a tree rather than a list, and you can see where each hit lives. A match's
own children are hidden unless they match too: answering "where are the things
I asked for" with their subtrees attached puts back most of what was taken
away.

It overrides collapse, because a filter that found something and then left it
hidden behind a closed ancestor would be answering a different question. Your
expand state is untouched underneath and comes back when you clear it.

Filtering 20,000 nodes down to 11,000 matches costs about the same as a plain
`refresh()` of the same tree — the mask walks up from each match and stops at
the first node already marked, so every ancestor is climbed once.

Like `isolate`, this prunes and lays out again rather than hiding things at
draw time, so the minimap, the keyboard tree and the exports all agree with
what is drawn. Unlike `isolate`, it is refitted afterwards for the same reason
it prunes: whatever the camera was framing has moved or gone.

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

## Layout

| Method | |
|---|---|
| `setLayoutOptions(settings, opts?)` | Change the shape and its tuning — `layout`, `layoutStep`, `rowGap`, `maxRings`, `colourBranches`, `spacing`, `orientation`, `rtl`. Relayouts without touching open state or the camera, which is what makes it usable behind a slider. Pass `{ fit: true }` to settle the view once a drag ends; the fit is queued until after the relayout, so it frames the new geometry rather than the one it replaced. |
| `setCentre(id \| null)` | **Sunburst only.** Drill into one node: it widens to the full circle and travels inward while everything else closes at the seam, over about 600ms. Nothing is pruned and the camera does not move — a wheel's frame does not depend on what is at its centre. `null` returns to the root. |
| `getCentre()` | The id currently at the middle of the wheel, or `null`. Pair it with each node's ancestors to build a breadcrumb. |

`setCentre` is deliberately not `isolate`. Isolating prunes the tree, so the
nodes that leave have no "after" and the change can only cut; a focus change
keeps every node and only moves it, which is what there is to animate.

## Instance

| Member | |
|---|---|
| `update(data, options?)` | Replace the data. Resets open state — use `refresh()` if all you did was change a size. |
| `subscribe(fn)` | Called with `ChartState` whenever it changes. Returns an unsubscribe. |
| `on(event, fn)` | See [Events](/api/events). Returns an unsubscribe. |
| `destroy()` | Removes everything it created and releases the worker. |

`ChartState` is `{ nodeCount, visibleCount, camera, bounds, rootScreenCentre }`.
