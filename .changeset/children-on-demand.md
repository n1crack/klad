---
'@klad/engine': minor
'@klad/core': minor
'@klad/vue': minor
'@klad/react': minor
---

Children on demand — a chart no longer needs its whole tree up front.

```ts
createKlad(host, {
  data: roots,
  mayHaveChildren: (item) => Number(item.childCount) > 0,
  loadChildren: (item) => fetch(`/api/children/${item.id}`).then((r) => r.json()),
})
```

Two options rather than one, because the chart can only know what it has been
given: a node with no children in `data` is indistinguishable from a leaf, so
something has to say there is more before anything can be fetched.
`mayHaveChildren` is that something, and "may" is honest — you are answering
from a count, and a node that turns out to have none becomes a leaf.

The chart keeps what `loadChildren` returns; your array stays as you gave it. A
`childrenLoaded` event fires if you want to persist it. An unloaded node starts
CLOSED whatever `collapsedByDefault` says — "open" is a claim about what is on
screen, and opening it is the only thing that ever asks for the load. It opens
when the children arrive, in the same relayout that brings them, and the node
you clicked holds its place while the tree grows underneath it.

Asked for once per node however hard a viewer clicks. A rejection is a
`load-failed` warning and leaves the node unloaded, so the next click retries;
nothing retries on its own. `expandAll()` and `expand(id, true)` fetch nothing.

`NodeContext.loading` says which node is waiting — what a card looks like while
it waits is a decision about your card. `NodeContext.hasChildren` is true for an
unloaded node, so your own chevron appears on it, and the screen-reader tree
gets the same answer, which is what makes these branches reachable without a
pointer.

Also new in the engine: the "more inside" mark now draws for the rectangular
layouts. It was computed for every layout and painted only for the wheels, so a
collapsed branch on a tidy or file chart said nothing at all below the zoom
where cards are drawn. It is a short stub leaving the node the way its first
connector would, ending in a dot — and it is what an unloaded node carries.
