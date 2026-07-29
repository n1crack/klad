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
| `stats(id)` | `{ directChildren, descendants, depth, height, leafCount, lft, rgt }`, or `null`. Describes the whole tree, not the expanded part. |
| `pathTo(id)` | The root-to-node id chain, inclusive. `null` for an unknown id. |
| `showMore(id)` | Lift the cap on the parent an aggregate node belongs to. `id` is the aggregate node's own. See [Very wide levels](/guide/wide-levels). |
| `reveal(ids)` | Bring specific children back past a cap without lifting it. |
| `refresh(opts?)` | Re-read every node's `nodeSize`, `label`, `maxChildren` and `pinChildren`, and lay out again — keeping expand/collapse, camera and highlight. `{ keep: id }` holds one node's screen position across the relayout. See [Sizing](/guide/sizing). |

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

## Editing

The three ways the tree's **shape** can change. Each returns whether it
happened, so a refused edit is something you branch on rather than something
you discover by looking.

| Method | |
|---|---|
| `move(ids, toParentId, index?)` | Move one or several under a new parent, at `index` among its children — appended when omitted, `null` makes them roots. |
| `add(items, parentId?, index?)` | Add rows. Omit the parent and each row keeps its own `parentId`; pass `null` to make them roots. |
| `remove(ids)` | Remove them **and everything below them**. |
| `getData()` | The rows the chart holds right now — your data with the edits applied. A copy. |
| `undo()` / `redo()` | Reverse the last edit, or put it back. See [Undo, redo and what to save](#undo-redo-and-what-to-save). |
| `changes()` / `isDirty()` / `markSaved()` | What to send, whether there is anything, and "sent". |
| `reconcile(data)` | Take a fresh copy of the tree without losing where the viewer is. See [Data that keeps arriving](#data-that-keeps-arriving). |

```ts
if (!chart.api.move('lead-42', 'engineering', 0)) {
  // refused — see below
}
```

### There is no rename

A node's text comes from your [`label`](/api/options) reading your own row, so
the chart does not know which field is the name and has no business writing
one. Change the row and call `refresh()`. The same goes for any other field:
the chart owns the shape, you own the content.

### A rule of your own

The chart's own rules are about what is a tree. Yours are about what your data
allows, and they go in [`canMove`](/api/options):

```ts
createKlad(el, {
  data,
  dragAndDrop: true,
  canMove: ({ items, parentId }) =>
    parentId === null || items.every((item) => item.kind !== 'contractor'),
})
```

Asked **during the drag**, so the indicator turns red and the cursor says
no-drop while the pointer is still down — refusing in `nodeDrop` answers after
the viewer has already committed and the node snaps back. Asked again at the
drop, and by `move()`, because a rule the pointer path honours and the API does
not is a hint rather than a rule.

During a drag it is consulted once per target node crossed, not once per
pointer move.

### What gets refused

- **Your own `canMove`**, if you wrote one.
- **A move into its own subtree**, because the result would not be a tree.
  Moving a node onto itself is the same test's degenerate case.
- **An id this chart does not have**, on either end.
- **An `add` whose id is already taken** — a duplicate id is the one thing
  the chart cannot make sense of.
- **Anything involving the node a [capped level](/guide/wide-levels)
  invents.** It is a real node in the tree, but it is the chart's own
  bookkeeping rather than a row of yours, so moving or deleting it would mean
  nothing. It is also left out of `getData()`, for the same reason.

### Without a pointer

Turn on [`keyboardEditing`](/api/options) and the focused node can be
restructured from the keyboard:

| | |
| --- | --- |
| `Alt` + `↑` / `↓` | One slot among its siblings. |
| `Alt` + `←` | Out one level, to just after its old parent. |
| `Alt` + `→` | In one level, under the sibling above it. |
| `Delete` / `Backspace` | The node and everything under it. |
| `Shift` + `Enter` | Asks for a new sibling — see below. |

Separate from `dragAndDrop`, which already gives the keyboard its own version
of a drag: `m` picks a node up, arrows carry the focus, `m` drops it there,
`Escape` puts it back. That one can only drop **into** a node, because dropping
between two means pointing at a gap and a list of rows has no gap to point at.
The keys above say "one up" instead, which needs no gap — and reordering is most
of what an outline or a taxonomy is made of.

They are kept as separate permissions because they are not the same one:
carrying a node somewhere is a rearrangement, and `Delete` is not.

`canMove` applies to every move here, exactly as it does to a drag. Each is one
edit, so one `undo` takes it back — including the whole subtree a `Delete` took.

**Adding is a request, not an action.** A new node needs a row and the chart
does not know what your rows look like — the same reason there is no rename. So
`Shift+Enter` emits [`addRequested`](/api/events) and waits:

```ts
chart.on('addRequested', ({ parentId, index }) => {
  const name = prompt('Name?')
  if (name !== null) chart.api.add({ id: crypto.randomUUID(), name }, parentId, index)
})
```

Ignore it and nothing happens.

### Undo, redo and what to save

```ts
saveButton.onclick = async () => {
  await fetch('/api/tree', { method: 'PATCH', body: JSON.stringify(chart.api.changes()) })
  chart.api.markSaved()
}
```

`changes()` describes what to **do** — `move`, `add`, `remove`, with ids rather
than indices, so a change still means the same thing after your own store has
moved on. What it takes to *reverse* each edit the chart keeps to itself.

**The log is the product; undo is the convenience.** An app with its own undo
stack does not want a second one underneath it — two stacks make Ctrl+Z a coin
toss. Set [`history: false`](/api/options), read `changes()`, and drive the
chart from yours.

Reversing a move puts each node back with **its own** former parent and slot,
which is not always the set's: a batch move can have come from several parents.
Reversing a remove puts the whole subtree back.

Positions are remembered as the sibling a node sat *after*, never as an index —
an index is only right until the next edit moves something in front of it.

`history` defaults to 100 edits, and costs memory rather than speed: nothing on
the drawing path reads it, and on a 20,000-node chart a move measures 328ms
without history and 337ms with. A record names ids, so it follows how much you
edit rather than how big the chart is. `remove` is the exception — it holds the
subtree it took out until that record falls off the end.

**Fresh data clears it.** `update` and `reconcile` are both somebody else
describing the tree, and an edit made before that description refers to a shape
nobody is claiming any more.

One limit stated rather than rounded: undoing back *past* the save point leaves
`isDirty()` true with nothing in `changes()` to send. The chart differs from
what was saved by an edit being **absent**, which no forward operation
describes — send `getData()` in that case.

### Data that keeps arriving

A poll came back, a socket pushed, another user moved something. That is not a
new tree — it is the same one, later.

```ts
socket.on('tree', (rows) => chart.api.reconcile(rows))
```

| | |
| --- | --- |
| `update(data)` | **A different tree.** Resets your expand state, forgets what `loadChildren` fetched, drops the caps you had lifted. Right when the chart is genuinely being pointed at something else. |
| `reconcile(data)` | **The same tree, later.** Keeps all of it, plus the camera, the selection and the filter. |

The difference animates: rows that arrived fade in, rows that left fade out,
everything else tweens to where it now sits. A viewer watching sees what
changed instead of the chart blinking.

A row new to the chart starts the way it would have started had it been in
`data` all along — `collapsedByDefault` decides, and it starts closed if
`mayHaveChildren` says it is waiting on a fetch.

**Lazily-fetched branches are kept**, because `data` never described them:
dropping them would collapse every branch the viewer had opened, on every
poll, on exactly the trees that need reconciling most. Two exceptions, both
forced — children whose parent is no longer in `data` go with it, and a row
`data` now carries itself replaces the fetched copy, since the newer statement
wins and a duplicate id is the one thing the chart cannot make sense of.

### One call, not a loop

An edit lays the tree out again — the whole tree, because a move changes where
everything after it sits. On a 20,000-node chart that is around 350ms, which a
person dragging one node never sees (the transition covers it) and a loop of a
hundred calls very much does.

Every method takes an array for this reason. Measured on the same 20,000-node
chart:

| | |
| --- | --- |
| One `move` | ~350 ms |
| 100 separate `move` calls | ~1300 ms |
| **100 ids in one `move` call** | **~355 ms** |

So a bulk reassign is one call with a hundred ids, not a hundred calls. Same
for `add` and `remove`.

### Removing takes the subtree

Leaving the children behind would turn each of them into a root, which is a
bigger change to the shape than the one asked for and not what anybody means
by "delete this branch". Move them out first if you want to keep them.

### What an edit leaves alone

Your expand state survives, keyed by id — unlike `update()`, which resets it.
Moving a node is not a reason to fold up the branch you moved it into, and
doing so would hide the result of the action. The one change an edit makes on
its own is opening the node's **new** parent.

The camera holds still, and the nodes tween to their new positions rather than
jumping, exactly as they do for a drag-and-drop — which is the same edit, taken
through the same door.

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

### Walking the results

`search` answers a question and changes nothing. `filter` changes what the
chart is. This is the third thing, and neither of those does it: keep the whole
tree in front of me and take me to the next hit.

```ts
chart.api.findNext('rossi')   // start, and go to the first
chart.api.findNext()          // the next
chart.api.findPrevious()      // back one
```

Each call brings the node onto screen, opening whatever it was folded behind.
It wraps at the end rather than stopping, so holding the key cycles. `null` when
nothing matched.

Any change to the tree forgets where it was — a place in a list of nodes that
have since moved is not a place. Give the query again to restart.

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
