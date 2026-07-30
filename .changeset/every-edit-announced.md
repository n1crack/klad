---
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

`edit` — every change to the shape, however it was made.

```ts
chart.on('edit', (change) => queue.push(change))
```

A drag reports itself through `nodeDrop` and an API call is something you made
yourself. A viewer pressing `Alt+Up` or `Delete` restructures the tree with
nobody else in the room — so with `keyboardEditing` on, a host could not know
an edit had happened, and therefore could not save it.

Carries the same `Change` that `changes()` collects, so persisting each edit as
it happens and batching them until a save button take the same shape. Fires
whether or not `history` is on: "keep no way back" and "tell me nothing" are
different requests. `undo` and `redo` do not fire it — they are calls you make,
and treating a withdrawal as a new edit would have anyone mirroring this apply
it twice.
