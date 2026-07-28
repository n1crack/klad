---
'@klad/core': patch
---

Four bugs found hunting through 1.5, three of them where a capped level meets
something else.

**Two drops in a row corrupted the data.** A reparent rebuilds the host's array
from the chart's current rows, and those included the node a cap invents. So
the first drop wrote an aggregate into `data`; the second renormalised that
array, planned a second aggregate for the same parent, and landed on a
duplicate id. The rows that came from outside the chart are now a separate
thing from the rows the chart adds to them, and only the first kind is ever
written back.

**A drop after that also lost the cap.** The same reparent normalised its own
array directly instead of replanning, so the aggregate vanished until something
else forced a full rebuild.

**`nodeDrop` reported the wrong index.** It counted among the DRAWN siblings,
and a capped level draws eight of four hundred. With a pin in the mix the two
numbers diverge by any amount: dropping after a pinned twentieth child reported
5. The index is now translated back into the parent's real child list, which
fixes the same divergence under a filter.

**Lifted caps survived `update(data)`.** They name nodes in the dataset being
replaced, so they lifted caps on ids that no longer existed — or on ones that
happened to exist again and that nobody had opened. Cleared now, like the
loaded children beside them.

Also: a `filter` drops a pending `focus`. A deferred focus waits for the
relayout that reveals its target, which for a node the filter excludes never
comes — and clearing the filter later would resolve the wait and jump the
camera somewhere nobody had asked to go any more. And `reveal` returns early
without a cap, rather than paying a full relayout to reveal nothing.
