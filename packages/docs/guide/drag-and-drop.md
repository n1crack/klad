---
title: Drag and drop
description: 'Turn on reparenting by drag: drop modes, refusing a move, spring-loaded branches, keyboard moves, and persisting the result to a server.'
---

# Drag and drop

Dragging a node onto another moves it there. It is one option:

```ts
const chart = createKlad(host, {
  data,
  dragAndDrop: true,
})
```

Off by default, and deliberately: a chart is as often a read-only picture as
an editor, and a drag that silently restructures someone's org is a worse
default than one that pans. Turning it on takes the drag gesture away from the
camera when it starts on a node — dragging the background still pans.

## Where a node can land

Aim at the middle of a node to drop **into** it, making it the new parent. Aim
at the leading or trailing quarter to drop **before** or **after** it, making
it a sibling instead.

Which axis those quarters run along is the layout's answer, not yours. A
`file` list is a column of rows, so its bands are top and bottom. A `tidy`
chart pointing down has siblings left and right, so its bands are left and
right — and pointing left or right, they flip. A `radial` or `sunburst` wheel
has no sibling axis a pointer could aim along at all, so it offers only
"into". You do not configure this; each layout already knows.

A drop into the branch you are carrying is refused — a node cannot become its
own descendant — and shown as such: the preview turns red and the cursor
becomes `no-drop`.

## Reacting to a move

`nodeDrop` fires **before** anything moves:

```ts
chart.on('nodeDrop', ({ ids, parentId, index }) => {
  fetch('/api/move', {
    method: 'POST',
    body: JSON.stringify({ ids, parentId, index }),
  })
})
```

The chart applies the move as soon as your handler returns, and animates the
result. `ids` is the whole selection when a selected node was dragged, in tree
order. `parentId` is `null` for a drop that makes a node a root. `index` is
the position among the new parent's children.

To refuse a move — a server rejected it, a rule forbids it, you want to
confirm first — call `preventDefault()`:

```ts
chart.on('nodeDrop', (event) => {
  if (event.parentId === 'archive') event.preventDefault()
})
```

Refusing is better than undoing. A handler that let the move happen and then
put it back would flash the wrong tree on the way, and would have to work out
how to reverse it.

For an async decision, refuse first and apply it yourself once you know:

```ts
chart.on('nodeDrop', async (event) => {
  event.preventDefault()
  const ok = await save(event.ids, event.parentId, event.index)
  // `applyMove` is your own: the chart's data is your array, and this is the
  // point at which you decide it changed.
  if (ok) chart.api.update(applyMove(data, event))
})
```

The handler returns before the `await` resolves, so `preventDefault()` has to
be the first thing in it. A promise the chart does not wait for is not a veto.

## Getting to a branch that is closed

Hold the pointer over a collapsed node for about half a second and it springs
open, so you can carry on into it. Branches that opened this way close again
when you let go, except the one you actually dropped into — wandering across
six folders on the way to the seventh should not leave all seven standing
open.

## Cancelling

**Escape** puts the node back down: no `nodeDrop`, nothing moved. The same
happens if the browser takes the gesture away mid-drag — a touch it decided
was a page scroll.

## Dragging near the edge

Holding a drag near the edge of the chart pans it, faster the closer you get.
The pointer stays where you are holding it and the chart moves underneath,
which is how a drop onto something off screen is possible at all.

## From the keyboard

The same move, without a pointer:

| Key      |                                             |
| -------- | ------------------------------------------- |
| `m`      | Pick up the focused node                    |
| `m`      | Drop it on the node you have moved focus to |
| `Escape` | Put it back down                            |

Each step is announced through a live region, since a keyboard user gets no
drop preview to look at. It goes through the same `nodeDrop` event, so a
handler written for the pointer already covers it.

## Styling

The chart sets its own cursor during a drag — `grabbing`, or `no-drop` over a
target that would refuse — and takes your cards out of the pointer's way for
the length of the gesture. Two classes are on the host element if you want to
go further:

| Class                | While                                     |
| -------------------- | ----------------------------------------- |
| `.klad-dragging`     | A drag is in progress                     |
| `.klad-drag-refused` | ...and the current target would refuse it |

The ghost that follows the pointer is a clone of the card you picked up, under
`.klad-drag-ghost`. When the zoom is too low for cards to be drawn, it falls
back to the node's label in `.klad-drag-ghost-label`, with the count of what
you are carrying in `.klad-drag-ghost-count`.

## Vue and React

The same event, named the way each framework names events:

```vue
<Klad :options="{ data, dragAndDrop: true }" @node-drop="onNodeDrop" />
```

```tsx
<Klad options={{ data, dragAndDrop: true }} onNodeDrop={onNodeDrop} />
```

`NodeDropEvent` types the handler's parameter, and every package exports it:

```ts
import { type NodeDropEvent } from '@klad/react'
```

## What it costs

The whole visible tree is laid out again on a drop, not just the branch that
changed. `tidy` is a global algorithm — moving one node changes sibling
separation all the way up — so "only the subtree that changed" is not
generally correct. It is also not worth chasing: a full relayout of 20,000
nodes measures 2–12ms, once, and the transition tweens the result for free.
