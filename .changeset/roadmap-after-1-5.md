---
'@klad/docs': patch
---

A new roadmap from 1.6 on.

1.6 is rewritten in terms of what you get rather than what it is called
internally — hand in your own layout function and the connector style that
belongs to it. It also picks up a gap this release turned up: every per-node
option is handed the node's data and nothing else, so none of them can answer a
question about where the node sits. A file list narrows every row by its own
indent and needs exactly that, and a row fetched by `loadChildren` is not in
the array you could have worked it out from.

1.7 is editing, and it is sharper than "more API": undo and redo, a chart that
knows when it has unsaved changes, and the changes readable as data so you can
send them wherever they go on whatever button you like. The chart holds the
edits; it does not decide what to do with them.

1.8 is a reconcile for data that keeps arriving. `update()` is a reload and
`refresh()` only helps if you changed your array in place — neither is what a
poll or a socket needs.
