---
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

Restructuring the tree from the keyboard.

```ts
createKlad(el, { data, keyboardEditing: true })
```

On the focused node:

| | |
| --- | --- |
| `Alt` + `↑` / `↓` | One slot among its siblings. |
| `Alt` + `←` | Out one level, to just after its old parent. |
| `Alt` + `→` | In one level, under the sibling above it. |
| `Delete` / `Backspace` | The node and everything under it. |
| `Shift` + `Enter` | Asks for a new sibling. |

Less was missing here than it looked: a node could already be moved from the
keyboard with `dragAndDrop` on — `m` picks it up, arrows carry the focus, `m`
drops it there. But that can only drop **into** a node, because dropping
between two means pointing at a gap and a list of rows has no gap to point at.
So the one thing an outline or a taxonomy is mostly made of — "this goes above
that" — had no keyboard equivalent at all. These keys say "one up" instead,
which needs no gap.

Kept as a separate permission from `dragAndDrop` because they are not the same
one: carrying a node somewhere is a rearrangement, and `Delete` is not.

`canMove` applies to every move here, exactly as it does to a drag, and each is
one edit, so one `undo` takes it back — including the whole subtree a `Delete`
took.

**Adding is a request, not an action.** A new node needs a row and the chart
does not know what your rows look like, the same reason there is no rename. So
`Shift+Enter` emits `addRequested` with the parent and index to use, and waits:

```ts
chart.on('addRequested', ({ parentId, index }) => {
  const name = prompt('Name?')
  if (name !== null) chart.api.add({ id: crypto.randomUUID(), name }, parentId, index)
})
```

Ignore it and nothing happens.

A key at the end of a level declines rather than doing a no-op move — the order
would look the same either way, but a move that changes nothing is still a full
relayout and an undo entry for nothing.
