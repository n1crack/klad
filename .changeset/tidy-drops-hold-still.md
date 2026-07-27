---
'@klad/engine': patch
'@klad/core': patch
---

A drop now animates, and holds the place you dropped it.

Two things a reparent got wrong. The chart rebuilt from a new dataset, which
as far as the engine was concerned shared no index space with the old one — so
every node snapped to its new position with no tween. And because a `tidy` or
`radial` layout reflows around the change, the destination you had just aimed
at slid somewhere else, leaving you to find your place again.

`ChartEngine.animateNextLayout(sourceRemap)` says the next `setData` is a MOVE:
the same nodes at different positions, with a mapping from the outgoing index
space to the incoming one. The transition then reads across it and tweens.
It is tied to `setData` rather than to "the next relayout" on purpose — the
mapping describes one replacement, so arming it without one does nothing.

The vanilla chart arms it on every drop and, alongside it, pins the drop
TARGET's screen position across the rebuild. The target, not the moved node:
anchoring what you dragged would pull the camera along with it, which is the
one thing that is supposed to move.
