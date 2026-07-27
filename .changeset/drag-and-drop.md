---
'@klad/engine': minor
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

Drag and drop — `dragAndDrop: true`.

Drag a node onto another to reparent it, or onto the leading or trailing
quarter of one to drop it beside that node instead. A reparent that could only
say "into" is half a feature: reordering siblings is most of what anyone does
with a file list.

Which axis those bands run along is a question only the layout can answer, so
it asks. A file list stacks downward whatever `orientation` says; a tidy chart
puts siblings across its growth axis; a wheel offers `into` and nothing else,
because sibling segments are arranged by angle and "three degrees
anticlockwise" is not a position anyone is pointing at.

Dropping into the branch you are carrying is refused — a node cannot become
its own descendant — and shown in the refusal colour rather than not shown,
since an absence cannot tell "not allowed" apart from "not pointing at
anything". The check is one array read per pointer move, from a subtree mask
built when the drag starts.

The move is reported through `nodeDrop` BEFORE anything happens; call
`preventDefault()` to refuse it. Dragging a selected node carries the whole
selection. The chart applies the move to its own copy of the data rather than
mutating the array you handed it, so reconcile your own store from the event.

New theme tokens: `dropStroke`, `dropRefusedStroke`, `dropStrokeWidth`. New
core exports for anyone building their own gesture layer: `resolveDropMode`,
`isDropAllowed`, `subtreeMask`, `dropPosition`.
