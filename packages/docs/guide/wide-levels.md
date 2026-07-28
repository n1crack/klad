---
title: Very wide levels
description: 'Cap a level with maxChildren, keep your working set with pinChildren, and reach what fell past the cap with showMore, reveal and focus.'
---

# Very wide levels

A manager with four hundred reports. A folder with ten thousand files. The
level is unreadable and the chart is unnavigable, and no amount of zooming
fixes either.

```ts
const chart = createKlad(host, {
  data,
  maxChildren: 8,
  pinChildren: (item) => watching.has(String(item.id)),
})
```

Eight children are drawn as themselves; everything after them is replaced by a
single node saying how many it stands for.

## Why it takes two options

`maxChildren` on its own is a **truncation**, and truncation shows whichever
children happen to come first. Working through five levels of a hundred where
seven or eight per level matter, that is nobody's eight.

`pinChildren` is what makes the cap useful: it says *which*. Your working set,
a search result, the current selection — anything you can express as a
predicate.

Pins are not part of the budget, they precede it. Pin ten with a cap of eight
and you get ten, because a pin is an instruction and a cap is a default. Order
among the shown children is the data's own either way, so a pinned child stays
where it was among its siblings rather than being hoisted to the front — and
nothing jumps around as the set changes.

For different budgets at different depths, `maxChildren` also takes a function
of the parent:

```ts
maxChildren: (item) => (item.kind === 'department' ? 12 : 6)
```

It caps **children**, so it does not cap the roots — they are nobody's
children, and there is no parent to hang the aggregate node off. A forest of
three hundred roots draws three hundred roots.

## Nothing is thrown away

The children that did not fit are still in the tree.

| | |
| --- | --- |
| `search` | Finds them. |
| `stats(id)` | Counts them: `descendants` on the capped parent is still all four hundred. |
| `filter` | Matches them. |
| `focus(id)` | Brings one back, digging it out of the cap on the way. |

That last one matters more than it looks. A cap has no toggle the way a
collapsed branch does, so without it a node three levels down whose ancestor
fell past a cap would be unreachable: `focus` would open every collapsed
ancestor and still show you nothing. It uncaps the path instead.

A cap is about what you can look at, not about what is there.

## The node that stands for the rest

It is a real node the chart invents, with an id of `klad:more:<parentId>` — so
if your own ids can start with `klad:more:`, they will collide. If your `label`
has no answer for it, it gets `+392`. Everything past that is yours:

```ts
renderNode: (element, context) => {
  const over = context.overflow
  if (over === null) {
    element.textContent = String(context.item.name)
    return
  }
  element.textContent = `+${over.count} more`
  element.onclick = () => over.showMore()
}
```

`context.overflow` is `null` on every ordinary node. On this one it carries:

| | |
| --- | --- |
| `count` | How many it stands for. |
| `ids` | Which — so a picker is possible without asking the chart for anything. |
| `showMore()` | Lift the cap on this parent: draw all of them. |
| `reveal(ids)` | Bring specific ones back **without** lifting the cap. |

`showMore` and `reveal` are bound to this node, so a card is self-contained and
does not have to reach back out for the chart instance from inside a render
callback — the same reason `toggle` is on the context rather than being
`expand(id)`.

### A picker on the aggregate node

The reason `ids` is there. Roughly fifteen lines:

```ts
const select = document.createElement('select')
select.append(new Option(`${over.count} more…`, ''))
for (const id of over.ids) select.append(new Option(labelFor(id), id))
select.onchange = () => over.reveal([select.value])
```

The chart does not build this for you, deliberately: a dropdown of 390 needs
its own search box, and at that point it is a second and worse tree browser
inside the first one. For "find that specific person", `search` plus `focus` is
the better answer, and it works across the whole tree rather than one parent's
children.

### What it is, and is not

It is real enough to lay out, be hit-tested, and appear in an export — an
export is a picture of the chart, and this node is in the chart. It is
deliberately none of the things that would leak it into your data model:

| | |
| --- | --- |
| `search` / `filter` | Never return it. Its `item` is a stub with nothing on it but an id, and its fallback label would let a filter for "1" match `+15`. |
| `stats(id)` | Does not count it. A card saying "21 reports" would be wrong about the only tree you have. |
| Dragging | Refused, from either side. It stands for nodes rather than being one, and `nodeDrop` must never report an id you have not seen — including when a box selection swept it up. |

The one place it does show is `lft`/`rgt`, which are positions in the chart's
own numbering rather than counts. Containment is unaffected; the
`rgt - lft === 2 * descendants + 1` identity holds only where nothing is
capped.

## Lifting a cap sticks

`showMore` and `reveal` survive a relayout. Somebody asked for them, and a
rebuild is not an undo. `update(data)` starts over, as it does with everything
else. Both are carried in `getView()` / `setView()` — a link that restored
everything except what the viewer had opened up would come back a different
chart.

## With a filter

A filter suppresses capping entirely. Someone who has asked for specific nodes
has said which ones they want; hiding part of the answer behind "and 12 more"
would be a second cap on top of theirs. See
[the chart API](/api/chart#searching-and-filtering-are-different-things).

## What it costs

The decision is one pass over your data per rebuild, grouped by `parentId` —
the same O(n) the chart was about to spend anyway. The hidden children are
removed at layout time rather than deleted, so the saving is real: a level of
four hundred lays out and draws nine nodes.
