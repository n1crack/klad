---
'@klad/docs': minor
---

Documented drag and drop, which 1.3 shipped without.

A new guide page covers turning it on, what the drop bands mean per layout,
refusing a move (including the async case, where `preventDefault()` has to
come before the first `await`), spring-loaded branches, cancelling, edge
panning, the keyboard equivalent, and the classes to style. `dragAndDrop` is
in the options table, `nodeDrop` and `selectionChange` are in the events
table — neither was there — and `nodeDrop`'s payload has a table of its own,
since it is the one event that fires before the thing it describes.

The playground's generated code now carries it too: `dragAndDrop` and
`selection` were being applied to the chart and then left out of the snippet,
so the drag-and-drop example's code pasted into a chart that panned when you
dragged a card, with nothing to say why. Every stack also gets the `nodeDrop`
handler, which is where an app makes the move stick.

Nested-set bounds return to the roadmap in 1.5, as computed values rather
than the storage format they were dropped as: `lft`/`rgt` on `stats(id)` turn
"is this node inside that branch" into a comparison instead of an ancestor
walk, which is what makes filtering a large tree by branch cheap.
