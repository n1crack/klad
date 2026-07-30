---
'@klad/core': minor
'@klad/engine': minor
'@klad/react': minor
'@klad/vue': minor
---

`edgeFlow` — a travelling dash on the branches that are live.

```ts
createKlad(el, {
  data,
  edgeFlow: (parent, child) => child.status === 'active',
})
```

For a flow, a dependency, a route that is carrying something. Asked once per
node when the data changes, never per frame. Colour, weight, dash pattern and
speed are theme tokens (`edgeFlowStroke` and friends).

**It keeps the chart drawing, and that is why it is a predicate rather than a
switch.** Everything else here renders only when something changes — an idle
chart costs nothing at all. A travelling dash has to advance every frame, so
for as long as one marked edge is in the visible tree the loop keeps going.
Marking one branch is cheap; marking everything is a decision about somebody's
battery. Collapse a branch and its edges stop counting.

Exports draw them as ordinary connectors: a dash frozen mid-travel in a still
is just an odd-looking gap. Reduced motion is left to you to honour, because
whether a flow still means anything standing still depends on what you are
using it for — the docs show the media query.

The playground has a **Flowing edges** example.
