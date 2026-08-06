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

`pinChildren` is what makes the cap useful: it says _which_. Your working set,
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

On a `radial` or `sunburst` wheel it caps a ring the same way, and the node
standing for the rest takes a segment of its own.

It caps **children**, so it does not cap the roots — they are nobody's
children, and there is no parent to hang the aggregate node off. A forest of
three hundred roots draws three hundred roots.

## Nothing is thrown away

The children that did not fit are still in the tree.

|             |                                                                            |
| ----------- | -------------------------------------------------------------------------- |
| `search`    | Finds them.                                                                |
| `stats(id)` | Counts them: `descendants` on the capped parent is still all four hundred. |
| `filter`    | Matches them.                                                              |
| `focus(id)` | Brings one back, digging it out of the cap on the way.                     |

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
  element.onclick = () => openYourPicker(over)
}
```

`context.overflow` is `null` on every ordinary node. On this one it carries:

|               |                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `count`       | How many it stands for.                                                                                  |
| `ids`         | Which.                                                                                                   |
| `items`       | Their data objects, in the same order — so a picker can show names without going back to your own array. |
| `reveal(ids)` | Bring specific ones back **without** lifting the cap.                                                    |
| `showMore()`  | Lift the cap on this parent entirely.                                                                    |

`reveal` swaps rather than adds: the cap is a budget, and what you ask for
takes a slot from it, so something else drops out. That is the same rule pins
follow — both get first claim, and the total stays at the cap unless they
alone exceed it. If you want more on screen rather than different things on
screen, that is `showMore`.

`showMore` and `reveal` are bound to this node, so a card is self-contained and
does not have to reach back out for the chart instance from inside a render
callback — the same reason `toggle` is on the context rather than being
`expand(id)`.

### Do not offer "show them all"

`showMore` exists, and it is the right answer for a level of twelve with a cap
of eight. It is the wrong answer for a level of four hundred: unreadable is the
problem the cap is solving, and a button straight back to unreadable is that
problem with an invitation attached.

What a big level wants instead is a way to **pick**. `items` is there so you
can build one without going back to your own data:

```ts
function openYourPicker(over) {
  // A search box over `over.items`, a checkbox per row, and only the rows in
  // view actually built — four hundred at once makes the click feel broken.
  // Tick a row and add its id to your working set; the chart draws it from
  // then on, because that is what `pinChildren` answers from.
}
```

Ticking pins rather than reveals, and the difference matters: a pin is
permanent and a reveal lasts until the next `update`. Both go through the same
budget, so a pinned node takes a slot and something else drops out — which is
correct, and is why "show them all" is not the shape of this.

The playground's [Very wide levels](https://klad.ozdemir.be/playground/)
example is exactly this, in about a hundred lines of plain DOM shared by all
three framework demos.

### What it is, and is not

It is real enough to lay out, be hit-tested, and appear in an export — an
export is a picture of the chart, and this node is in the chart. It is
deliberately none of the things that would leak it into your data model:

|                     |                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search` / `filter` | Never return it. Its `item` is a stub with nothing on it but an id, and its fallback label would let a filter for "1" match `+15`.                                           |
| `stats(id)`         | Does not count it. A card saying "21 reports" would be wrong about the only tree you have.                                                                                   |
| Dragging            | Refused, from either side. It stands for nodes rather than being one, and `nodeDrop` must never report an id you have not seen — including when a box selection swept it up. |

The one place it does show is `lft`/`rgt`, which are positions in the chart's
own numbering rather than counts. Containment is unaffected; the
`rgt - lft === 2 * descendants + 1` identity holds only where nothing is
capped.

## Changing the working set

`pinChildren` is read again on every `refresh()`. That is how a set you mutate
reaches the chart — nothing about the options object or the data changed when
it did, so there is nothing else for the chart to notice:

```ts
watching.add('lead-42')
chart.api.refresh()
```

Keep the _set_ mutable and the _function_ stable. A new `pinChildren` on every
render is what makes Vue and React tear the chart down, which resets both the
open branches and every cap the viewer had lifted.

## Lifting a cap sticks

`showMore` and `reveal` survive a relayout. Somebody asked for them, and a
rebuild is not an undo. `update(data)` starts over, as it does with everything
else. Both are carried in `getView()` / `setView()` — a link that restored
everything except what the viewer had opened up would come back a different
chart.

## In Vue and React

Both options pass straight through. One caveat in both, and it bites harder
here than elsewhere: define `pinChildren` and `maxChildren` **outside** the
render, or memoise them. Vue watches the options object deeply and React
compares it by identity, so a function rebuilt every render triggers
`update()` every render — which resets the open branches _and_ every cap the
viewer had lifted.

If your working set is reactive, keep the _set_ reactive and the _function_
stable:

```ts
const watching = new Set<string>() // mutate this
const pinChildren = (item) => watching.has(String(item.id)) // never rebuilt
```

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

Measured on a 20,000-node forest, a full re-read and relayout takes 328ms
uncapped and 315ms with a cap and a pin predicate. Capping is not something you
pay for; it is something that pays for itself, because it draws far less.
