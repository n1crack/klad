---
'@klad/core': minor
'@klad/engine': minor
'@klad/react': minor
'@klad/vue': minor
---

Walking the search results, counting leaves, and two events that were missing.

### findNext / findPrevious

```ts
chart.api.findNext('rossi')   // start, and go to the first
chart.api.findNext()          // the next
chart.api.findPrevious()      // back one
```

`search` answers a question and changes nothing; `filter` changes what the chart
is. This is the third thing and neither of those does it: keep the whole tree in
front of me and take me to the next hit. Each call brings the node on screen,
opening whatever it was folded behind, and wraps at the end rather than stopping.

Any change to the tree forgets where it was — a place in a list of nodes that
have since moved is not a place.

### leafCount on stats(id)

```ts
chart.api.stats('src')!.leafCount   // how many files, at any depth
```

A different question from `descendants`, and usually the one being asked: "how
many files are in this folder" rather than "how many rows does this branch
occupy". Filled by the same sweep that already totals the descendants, so it
costs nothing, and it leaves out the nodes a capped level invents exactly as the
other counts do.

### filterChange and layoutChange

```ts
chart.on('filterChange', ({ query, matched }) => count.textContent = `${matched.length}`)
chart.on('layoutChange', ({ settings }) => mirror(settings))
```

`layoutChange` carries the settings as they now stand rather than the delta, so
a sidebar mirroring the chart reads what IS instead of what it last sent. A knob
nobody has set is absent rather than `undefined`, so spreading the payload over
your own state does not punch holes in it.

`filterChange`'s `query` is `null` both for no filter and for a predicate, which
cannot be written down — the same limit `getView` states.

---

A general camera-animation API was considered and is not here, because it
already exists: `setView(view, { animate: true })` flies to any camera, and
`focus(id)` is the "go to this node" case with the ancestors opened on the way.
