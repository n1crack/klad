---
'@klad/core': patch
---

Three more from the bug hunt, each one the chart's own bookkeeping showing
through somewhere it should not.

**The export lost the "more inside" mark on an unfetched branch.** That rule
lives in two places by necessity — in worker mode the live engine is
unreachable from the main thread, so the export recomputes it — and children on
demand taught the engine about unloaded nodes without teaching the mirror. The
mark was on the canvas and missing from the picture of the canvas.

**A cap's aggregate node could be sent to `loadChildren`.** It is childless by
construction, so any `mayHaveChildren` loose enough to say yes to a stub with
none of the host's fields would put a "more inside" mark on the chart's own
invention and then fetch it.

**A filter could match it.** Its fallback label is `+15`, so `filter('1')`
matched. `search` already refused it; `filter` now does too, for the same
reason: both answer questions about the host's data, not about the chart's
bookkeeping.

Also covered: caps and filters through the worker, which every other test for
them ran in-process; a cap of zero and a cap bigger than the level; and the
fact that `maxChildren` caps children and therefore not roots, which is now
stated in the guide rather than left to be found.
