---
'@klad/core': patch
---

Lifting a cap, and loading a branch, now hold their place.

**The camera.** Clicking "+392 more" makes that level three hundred and
ninety-two nodes wider, and a `tidy` parent is centred over its children — so
the node you clicked from slid hundreds of pixels away while you were looking
at it. The parent is now pinned across the rebuild, the same way a drop pins
its target. Not the aggregate node: lifting the cap is what removes it.

**The minimap.** Neither a lifted cap nor an arriving branch asked it to refit,
though both change what the map is a map OF at least as much as isolating does
— which has asked for one since 1.1. Without it the whole chart ends up drawn
in the corner the capped level used to occupy.

Also documented: `maxChildren` and `pinChildren` must be defined outside the
render in Vue and React, or memoised. Both adapters call `update()` when the
options object changes identity, and that now resets every cap the viewer had
lifted as well as the open branches — so an inline arrow undoes their work on
every render.
