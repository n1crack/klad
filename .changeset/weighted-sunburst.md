---
'@klad/engine': minor
'@klad/core': minor
---

`weight` — a sunburst whose sectors are sizes, not counts.

```ts
createKlad(el, {
  data,
  layout: 'sunburst',
  weight: (item) => Number(item.sizeKb ?? 0),
})
```

Until now every leaf took an equal slice of its parent's arc, so a 1 KB config
file and a 480 KB bundle drew the same sector — a picture of the directory
listing rather than of the disk. `weight` is read on the LEAVES; a parent's
share is the sum of what is under it whatever the function returns for the
parent itself, because that is the only definition under which a ring is
exactly the union of the ring outside it.

Zero, negative and non-finite all count as zero: a leaf worth nothing gets no
arc, which is the honest picture. A tree where nothing is worth anything falls
back to counting, rather than dividing by zero.

Two more pieces that go with it:

- **`nodeHighlightRecolours`** and **`highlightLift`** — a lit node can keep
  its own fill and get brighter instead of being repainted in `highlightFill`.
  On a wheel a sector's colour is which branch it belongs to, so flooding it
  with one accent answers "which one is the pointer on" by deleting the answer
  to "what is it". The lift is a shift in OKLab lightness, so one number is the
  same perceived step on a pale leaf and a saturated root.
- **`chart.api.overflow(id)`** — what an aggregate node stands for, reachable
  without rendering one. A canvas-only chart has no `renderNode` to read
  `NodeContext.overflow` from, and "what is inside this +42" is a fair question
  to ask about a sector you can see.

Two fixes that came with it:

- `toSVG`/`toBlob`/`print` lay the tree out again from scratch rather than
  reading the engine's geometry, and were not given the weights — so an
  exported wheel divided its arcs by leaf count while the one on screen divided
  them by size. Same for worker mode, where the weights never reached the
  message at all.
- A cap no longer invents an aggregate node to stand for exactly ONE child. It
  took the room the child would have taken, said strictly less, and cost a
  click to get back what was already there.
