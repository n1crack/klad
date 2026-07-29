---
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

Three ways the tree's shape can change, and a place to put your own rule about
them.

```ts
chart.api.move('lead-42', 'engineering', 0)
chart.api.add({ id: 'new-hire', name: 'Sam' }, 'engineering')
chart.api.remove('closed-team')
chart.api.getData()   // your rows, with the edits applied
```

Each returns whether it happened. Dragging was the only edit there was, and it
now goes through the same door, so what is true of one is true of both.

**There is no rename, and there cannot be.** A node's text comes from your
`label` reading your own row, so the chart does not know which field is the
name. It owns the shape; you own the content. Change the row and `refresh()`.

### Your rule, asked while the pointer is still down

```ts
canMove: ({ items, parentId }) =>
  parentId === null || items.every((item) => item.kind !== 'contractor')
```

Refusing in `nodeDrop` answered too late: the drop indicator had already said
"yes, here", and the node snapped back after the viewer let go. `canMove` is
asked during the drag, so the indicator turns red under the pointer instead —
and again at the drop, and by `move()`, because a rule the pointer path honours
and the API does not is a hint rather than a rule.

Consulted once per target node crossed rather than once per pointer move.

### The rest of what gets refused

A move into a node's own subtree, since the result would not be a tree — two
comparisons on the nested-set bounds rather than an ancestor walk. An id the
chart does not have. An `add` whose id is already taken. And anything touching
the node a capped level invents: it is a real node in the tree, so each of
these says no on purpose.

`remove` takes the subtree with it. Leaving the children behind promotes each
of them to a root, which is a bigger change than the one asked for.

### One call, not a loop

An edit lays the whole tree out again. On 20,000 nodes that is about 350ms —
invisible behind the transition when a person drags one node, very visible in a
loop. Every method takes an array for this reason: 100 separate `move` calls
measure ~1300ms, the same 100 ids in one call ~355ms.
