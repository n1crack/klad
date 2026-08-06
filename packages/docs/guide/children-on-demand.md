---
title: Children on demand
description: 'Load a branch when it is opened: mayHaveChildren, loadChildren, the loading state, failures and retries, and how it works with drag and drop.'
---

# Children on demand

A chart normally needs its whole tree up front. That rules out the trees where
the shape matters most — a file system you cannot enumerate, a taxonomy behind
an API, an org of a hundred thousand people. Two options change that:

```ts
const chart = createKlad(host, {
  data: roots,
  mayHaveChildren: (item) => Number(item.childCount) > 0,
  loadChildren: (item) => fetch(`/api/children/${item.id}`).then((r) => r.json()),
})
```

Now `data` is only what you already have. The rest arrives the first time
somebody opens a branch.

## Why it takes two options

The chart can only know what it has been given. A node with no children in
`data` is indistinguishable from a leaf — no mark, no chevron, nothing to
click — so before anything can be fetched, something has to say there is
more.

`mayHaveChildren` is that something, and **may** is the honest word: you are
usually answering from a count, and a count can be wrong. A node that turns
out to have none once `loadChildren` returns simply becomes a leaf. Nothing
breaks.

It is only consulted for nodes with no children in `data` — a node that
already has some is not waiting for anything — and ignored entirely without
`loadChildren`, because a mark inviting a click that cannot lead anywhere is
worse than no mark.

Keep it cheap: it runs once per node whenever the data changes. A property
read or a comparison. At twenty thousand nodes a trivial predicate costs well
under a millisecond against a ~27ms toggle and does not show; one that does
real work per node would.

## What happens on a click

1. The node is marked as having more inside, and starts **closed**. Whatever
   `collapsedByDefault` says: "open" is a claim about what is on screen, and an
   unloaded node has nothing to show. It is also the only way the load can ever
   be asked for, since opening it is what asks.
2. Clicking it calls `loadChildren`. The node does **not** open yet — an empty
   branch saying "nothing here" for the length of a request is the one thing
   that is not true.
3. The children arrive, the node opens, and the layout settles around them
   rather than jumping. The node you clicked stays under your cursor while the
   tree grows underneath it.

Each node is asked for once. Clicking three times while a request is in flight
sends one request; collapsing and re-opening afterwards is an ordinary toggle.

## Showing that it is working

The chart cannot draw a loading state for you — what a card looks like while
it waits is a decision about your card. It tells you when:

```ts
renderNode: (element, context) => {
  element.textContent = String(context.item.name)
  element.classList.toggle('is-loading', context.loading)
}
```

`context.hasChildren` is true for a node whose children have not arrived, so
your own chevron appears on it without any extra work.

On the canvas itself — below the zoom where cards are drawn — a node with
children it is not showing carries a short stub ending in a dot, leaving it the
way its first connector would. On a wheel the same fact is an arc just inside
the segment, or a halo around the dot.

## When it returns

```ts
chart.on('childrenLoaded', ({ id, items }) => {
  // Optional. The chart holds them either way.
})
```

The chart keeps what you return; your `data` array stays as you gave it. This
event is for a host that wants to persist the result — cache it, put it in a
store — not something you have to handle.

Returned items are ordinary nodes. A `parentId` you set is honoured, so
returning a whole subtree in one call works; one you leave off is filled in
with the node being loaded, which is why the common case is just the children.

## When it fails

A rejection is reported as a `load-failed` warning and leaves the node
unloaded, so the next click retries:

```ts
chart.on('warning', (warning) => {
  if (warning.code === 'load-failed') toast(`Could not open ${warning.ids[0]}`)
})
```

Nothing retries on its own. A chart that re-fired a failing request would do it
for every node somebody touches, and you are the only one who knows whether the
failure is worth repeating. If you want the `Error` itself — a status code, a
stack — catch it inside your own `loadChildren`, which is the only place it
exists.

## What does not fetch

Only the single-node open paths ask for a load: a click, `expand(id)`, the
keyboard's Enter, Space or right arrow, and a drag resting on the node.

`expandAll()` and `expand(id, true)` open what is already there and fetch
nothing. "Open everything" on a tree of unknown size is a request nobody means
to make — it would fan out into one request per node, of unknown number.

## With drag and drop

A closed branch used to be unreachable during a drag. It is not any more:
resting the pointer on one springs it open, and if it has not been fetched yet
that is a fetch. The children arrive mid-gesture and the drop preview
re-resolves against them.

See [Drag and drop](/guide/drag-and-drop).

## `refresh()` and `update()`

|                |                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `refresh()`    | Keeps everything loaded. It says the data did not change.                                                 |
| `update(data)` | Drops it. A new dataset — what was fetched belonged to the old one, and its parents may not even be here. |

A drop folds the loaded nodes into the data array, since a reparent replaces
that array anyway. Nothing is lost; the nodes simply stop being tracked
separately from that point.

## Vue and React

Both options are ordinary options, so they pass straight through:

```vue
<Klad :options="{ data, mayHaveChildren, loadChildren }" @children-loaded="onLoaded" />
```

```tsx
<Klad options={{ data, mayHaveChildren, loadChildren }} onChildrenLoaded={onLoaded} />
```

One caveat in both: define `loadChildren` **outside** the render, or memoise
it. Vue watches the options object deeply and React compares it by identity, so
a function rebuilt every render triggers `update()` every render — which drops
both the loaded children and the open branches.
