---
'@klad/engine': minor
'@klad/core': patch
---

Fixed: a move had no transition in worker mode.

The worker renders after every message. The vanilla layer sent the filter and
cap masks as their own calls right after `setData`, so the relayout that built
the move's transition was followed immediately by one that dirtied the layout
and threw it away. On the main thread both land inside a single frame and one
relayout sees everything — which is why nothing caught it: every test for this
ran the engine in-process.

The masks now travel with the data, as two more optional arguments to
`setData`. They are indexed against that tree and belong in the same breath as
it. `setFilter` and `setOverflow` remain for changing either without a data
change.

What this fixes in practice: pinning a node onto a capped level animates. The
card that lost its slot fades out while room is being made; the pinned one
fades in after. Before, in a worker-backed chart — which is the default — both
happened between one frame and the next.
