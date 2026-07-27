---
'@klad/engine': minor
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

Drag and drop, completed.

**A card follows the cursor.** The node stays where it is, dimmed, and a copy
travels — the convention every file manager uses, and for a reason: the
original is where the node still is until you let go, and a drag you can
abandon needs something to abandon it to. The copy is a clone of your own
overlay element, so it looks exactly right whatever your card is, including
your CSS.

**The chart pans at the edges.** Without it a drop is only possible onto
something already on screen, which on a chart big enough to need dragging is
usually the wrong place. The speed ramps with depth into the zone rather than
switching on at a line.

**The keyboard can move a node too.** Focus a row in the screen-reader tree,
press `m` to pick it up, move to another row, press `m` again to drop it in,
or Escape to put it back. Announced through a live region, because a keyboard
user gets no drop preview — the announcement is the feedback, not a courtesy
on top of it. `into` only: the row list gives no way to point at a gap between
two things, and reparenting is the part with no other keyboard route.

**`nodeDrop` in Vue and React.** `@node-drop` and `onNodeDrop`, emitted
synchronously so `preventDefault()` on the payload still works.

Also: overlay elements now carry `data-klad-id`. Slots are pooled and
reassigned as the camera moves, so this is the only way to find the element
currently showing a given node — a drag needs it to clone the card, and a test
needs it to assert a node rendered.
