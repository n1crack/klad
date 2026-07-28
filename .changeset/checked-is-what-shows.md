---
'@klad/docs': patch
---

The picker's checkbox now means exactly one thing: on the chart.

It listed only what the aggregate node stands for, so the nodes already on the
level were absent — and an "on chart" marker for them was worse, because
pinning somebody else pushes them off and the marker went stale the moment you
used it.

Opening a picker now takes the level over: whatever is on it becomes pinned,
and from then on that level shows exactly what is ticked. `maxChildren` takes a
function of the parent, so this is just `0` once a parent is curated — without
it the cap's budget refills with whoever was unticked and a box you cleared
ticks itself straight back on.

Three states collapse into two, and both are true. The pinned dot on cards goes
with them: once everything drawn on a curated level is pinned, a mark saying so
says nothing.
