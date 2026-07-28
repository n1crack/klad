---
'@klad/docs': patch
---

Three playground fixes from using it.

**The level slid away while picking.** Ticking somebody swaps who is on that
level; the chart now holds the aggregate node you opened the panel from, so the
panel stays over the thing it belongs to.

**Pinned nodes and loading nodes now say so.** A small dot for "this one is here
because you asked", and a moving stripe along the bottom edge while
`loadChildren` is in flight — a card has no chevron to put that on, so a click
that starts a network request had no feedback at all. A stripe rather than a
spinner: several branches can be loading at once and several spinners reads as
a chart that is failing rather than working.

**File rows lost their right edge.** The layout shrinks each row by its own
indent so they all END at a common right edge, and it reads the depth from the
example's data — which a node fetched by `loadChildren` is not in. Those came
out at depth 0, kept full width, and pushed their trailing column right: a
staircase instead of a column. An example whose ids are paths can answer for
its own fetched nodes now, and does.
