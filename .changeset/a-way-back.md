---
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

Undo, redo, and the changes as something you can send.

```ts
chart.api.undo()
chart.api.changes()   // what to PATCH
chart.api.markSaved() // sent
```

A drag that restructures somebody's organisation with no way back is a
frightening thing to hand a user. Every edit is recorded — drags included,
since a drag goes through the same door the API does.

**The log is the product; undo is the convenience.** An app with its own undo
stack does not want a second one underneath it, because two stacks make Ctrl+Z
a coin toss. Set `history: false` and read `changes()` instead — it still
works with the history off.

`changes()` describes what to **do**, with ids rather than indices, so a change
still means the same thing after your own store has moved on. What it takes to
reverse an edit the chart keeps to itself.

Reversing a move puts each node back with **its own** former parent and slot,
which is not always the set's — a batch move can have come from several
parents. Reversing a remove puts the whole subtree back. Positions are
remembered as the sibling a node sat *after*, never as an index: an index is
only right until the next edit moves something in front of it.

`history` defaults to 100 edits. It costs memory rather than speed — nothing on
the drawing path reads it, and a move on a 20,000-node chart measures 328ms
without history and 337ms with. A record names ids, so it follows how much you
edit rather than how big the chart is; `remove` is the exception, holding the
subtree it took out until that record falls off the end.

Fresh data clears it: `update` and `reconcile` are both somebody else
describing the tree, and an edit made before that description refers to a shape
nobody is claiming any more.

Also: `add(rows)` with the parent left off now keeps each row's own `parentId`
instead of making them all roots. `null` still means roots. That is what
putting a removed subtree back needs, and it is the rule `loadChildren` already
follows for the rows it returns.
