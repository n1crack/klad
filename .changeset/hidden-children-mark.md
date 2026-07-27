---
'@klad/engine': minor
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

The wheel layouts now show when a node is hiding something.

A radial marker is a dot and a sunburst segment is a slice of a ring — neither
has room for a disclosure control, so a collapsed branch there looked exactly
like a leaf. The chart was omitting the fact that there was more, which is
worse than showing less.

Nodes whose children are all off screen now carry a mark: a second arc just
inside a segment's outer edge, a halo around a radial marker. "Off screen"
covers both reasons a wheel has — the branch is closed, or its children fell
outside `maxRings` — because those are one question to a viewer and get one
answer. It is computed once per relayout (`Frame.hasHidden`), not per frame,
and the array is `null` whenever nothing is hiding anything, which is the whole
steady state of a fully expanded chart.

The SVG and PNG exports draw it too.

The `radial` layout also gains `toggleOnNodeClick` in the playground's preset:
paired with the mark, it gives a viewer a way to open and close branches on a
chart whose nodes are too small to hold a button.
