---
'@klad/core': patch
---

A pin that swaps says which node it brought in.

With slots to spare, pinning somebody does not widen a capped level — it takes
the slot off whoever was last. That is a cross-fade in the same place, and what
it reads as is "the whole thing re-rendered" rather than one node arriving. The
chart now flashes its confirmation ring on the arrival: the existing "the thing
you asked for is HERE" marker, and one node arriving is exactly the single-node
action it was built for.

Only when exactly one node comes out from behind the cap. A `showMore` brings
back fifteen at once and rings none of them, because fifteen rings is a strobe.

The two behaviours this makes legible were already correct and are now covered:
below the cap a pin SWAPS — three stay three, and the one that lost its slot is
the last of them — and past the cap the pins win and the level grows instead.
