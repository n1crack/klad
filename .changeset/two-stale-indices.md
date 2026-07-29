---
'@klad/core': patch
'@klad/engine': patch
'@klad/react': patch
'@klad/vue': patch
---

Two bugs where a source index outlived the tree it meant something in.

**Isolating a branch, then changing the data, isolated the wrong branch.**
`isolate` held a source index, and a source index means nothing once the tree
is rebuilt — so a drag-and-drop, a lazily-loaded branch, a cap change or an
edit left the chart framing whichever node inherited the old slot, and
reporting that node's id back through `getState().isolated`. It is held by id
now and resolved on every rebuild, alongside the filter and cap masks that were
already re-derived for exactly this reason. If the isolated node leaves the
tree, the chart shows the whole tree rather than an arbitrary branch.

**A rebuild that both reordered the data and took nodes out of view could crash
the relayout.** The engine's transition builder reads the previous tree in the
old index space and the maps it looks things up in are keyed by the new one.
Mixing them is invisible until both happen at once — a drop reorders but
nothing leaves the view, a collapse has things leave but does not reorder —
and then a fading node is looked up under another node's key: usually it fades
from the wrong place, and when the key is missing entirely the box comes back
`undefined` and reading it took the whole frame down. Isolating and then
reconciling does both.
