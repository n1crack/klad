---
'@klad/engine': minor
'@klad/core': minor
---

Very wide levels: `maxChildren` and `pinChildren`.

```ts
createKlad(host, {
  data,
  maxChildren: 8,
  pinChildren: (item) => watching.has(String(item.id)),
})
```

Eight children are drawn as themselves and everything after them is replaced
by a single node saying how many it stands for.

Two options rather than one, because a cap on its own is a truncation and
truncation shows whichever children come first. Working through five levels of
a hundred where seven or eight per level matter, that is nobody's eight.
`pinChildren` says which. Pins precede the budget rather than being part of it
— pin ten with a cap of eight and you get ten, because a pin is an instruction
and a cap is a default — and order stays the data's own, so a pinned child does
not get hoisted to the front.

**Nothing is thrown away.** The children that did not fit are still in the
tree: `search` finds them, `stats` counts them, `filter` matches them, and
`focus` digs one back out. That last is not a nicety — a cap has no toggle the
way a collapsed branch does, so without it a node whose ancestor fell past a
cap would be permanently unreachable.

`NodeContext.overflow` is `null` on ordinary nodes and on the aggregate carries
`count`, the `ids` it stands for, and `showMore()` / `reveal(ids)` bound to that
node — so a card, or a picker built from `ids`, is self-contained rather than
having to reach back out for the chart instance from inside a render callback.
`showMore` and `reveal` are also on the chart API. A lift sticks: somebody
asked for it and a rebuild is not an undo.

A filter suppresses capping entirely, since asking for specific nodes has
already said which ones you want.

The engine's half is `setOverflow(hide)`, a source-indexed mask. Hidden rather
than absent is the load-bearing choice: only the drawn tree is smaller, which
is what lets every other claim above be true.
