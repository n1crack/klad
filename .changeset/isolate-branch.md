---
'@klad/core': minor
'@klad/vue': minor
'@klad/react': minor
'@klad/engine': minor
---

`isolate(id)` — show one branch as if it were the whole chart.

`fitSubtree` points the camera at a branch and leaves the rest of the chart
where it was, off screen. `isolate` re-roots the tree: that node becomes the
root and everything else stops existing as far as layout, hit-testing, the
minimap, the keyboard tree, search and export are concerned. On a chart of tens
of thousands of nodes that is the difference between a tight camera on a big
chart and a small chart.

`isolate(null)` restores the whole tree. `getState().isolated` reports it, and
a saved view carries it, so a link can open someone else on the same branch.
Where the viewer is inside the whole tree is left to the host to say —
`pathTo(id)` returns the chain from the real root, which is a breadcrumb.
