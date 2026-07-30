---
'@klad/core': minor
'@klad/engine': minor
'@klad/react': minor
'@klad/vue': minor
---

`edgeStyle: 'bezier'` — a curved connector.

```ts
createKlad(el, { data, edgeStyle: 'bezier' })
```

The same two ends a `'tiered'` elbow joins, with a curve in between instead of
a right angle. It leaves the parent and enters the child square-on, so a run of
siblings still reads as one fan rather than as lines pointing at each other,
and it honours `orientation` the way the elbow does.

The one style no layout asks for, which is the point: every other value is some
layout's own idea of a connector. This is there for a chart that wants a softer
line.

The SVG export draws the same curve from the same control points, and the
culler needs no special case — the control points sit inside the rectangle the
two ends span, so the box that bounded an elbow bounds this too.
