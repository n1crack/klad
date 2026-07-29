---
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

`reconcile(data)` — take a fresh copy of the tree without losing where the
viewer is.

```ts
socket.on('tree', (rows) => chart.api.reconcile(rows))
```

`update(data)` means "this is a different tree": it resets your expand state,
forgets what `loadChildren` fetched, and drops the caps you had lifted. That is
right when the chart is genuinely being pointed at something else, and wrong
several times a minute when a poll or a socket is feeding it the same tree.
Until now it was the only door, so a chart driven from a live source folded
itself back up under the viewer on every message.

`reconcile` keeps all of that, plus the camera, the selection and the filter —
and the difference animates: rows that arrived fade in, rows that left fade
out, everything else tweens to where it now sits.

A row that is new to the chart starts the way it would have started had it been
in `data` from the beginning: `collapsedByDefault` decides, and it starts closed
if `mayHaveChildren` says it is waiting on a fetch.

**Lazily-fetched branches survive**, because `data` never described them —
dropping them would collapse every branch the viewer had opened, on every poll,
on exactly the trees that need reconciling most. Two exceptions, both forced:
children whose parent is no longer in `data` go with it, and a row `data` now
carries itself replaces the fetched copy, since the newer statement wins and a
duplicate id is the one thing the chart cannot make sense of.
