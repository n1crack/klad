# Sizing

`nodeSize` defaults to `{ w: 180, h: 64 }`, and whatever you set it to is
**declared** rather than measured:

```ts
nodeSize: Size | ((item: NodeData) => Size) // Size = { w: number; h: number }
```

The default is enough for a name-and-role card at 1:1, which is why a first
chart needs nothing but `data`. Past that, the number is yours to set — and it
is a number you set rather than one the library reads back off your card.

Every DOM-based org chart can mount a node, read its
`getBoundingClientRect()`, and lay the tree out around whatever size it turned
out to be. This one cannot, and that is not an oversight.

Layout runs inside a Web Worker. There is no DOM there: no element to mount,
nothing to measure, no `getBoundingClientRect` to call. Moving layout off the
main thread is a large part of why a 50,000-node tree stays interactive, and
declaring sizes is the price. Your content fits the box you declare; it does
not decide it.

## One size, or a size per node

```ts
// Every node the same.
nodeSize: { w: 180, h: 64 }

// Or per node, from its own data.
nodeSize: (item) => (item.parentId === undefined ? { w: 240, h: 88 } : { w: 180, h: 64 })
```

The function is called once per node per layout, not per frame.

## When a card changes height

A card that opens a detail pane, grows a badge row, or switches to a taller
variant has changed a number the layout was built from. Tell the chart to
re-read it:

```ts
item.detailOpen = true
chart.api.refresh()
```

`refresh()` re-reads `nodeSize` and `label` for every node and lays out again,
keeping expand/collapse state, the camera and the highlight exactly as they
are.

::: warning Not `update()`
`update(data, options)` replaces the data and resets the tree's open state —
it throws away exactly what the user was looking at. It is the right call when
the data genuinely changed; it is the wrong one for a re-measure.
:::

`refresh()` snaps rather than animating: it is a re-measure, not a toggle, and
there is no single node for a transition to be anchored on.

## Animating a size change

Because `nodeSize` is read at layout time, animating a node's size means
animating the number `nodeSize` returns and re-measuring as it changes:

```ts
const OPEN_H = 132
const CLOSED_H = 72

const options = {
  nodeSize: (item) => ({
    w: 232,
    h: CLOSED_H + (OPEN_H - CLOSED_H) * Number(item.slide ?? 0),
  }),
}

// Then ease `item.slide` from 0 to 1 over ~200ms, calling `chart.api.refresh()`
// on each frame.
```

That is a full relayout per frame for the duration of the slide. On a few
dozen nodes it is free; on a large tree it is not, and the distinction is
deliberate — the library's own expand/collapse transition interpolates
positions it has already computed, precisely so it never relayouts per frame.
Animate sizes on the nodes a user is looking at, not on the whole org.

## Spacing

`spacing` controls the gaps the layout leaves between nodes, in world units:

```ts
spacing: { x: 16, y: 48 } // the defaults
```

`x` separates siblings, `y` separates levels — and they swap meaning with a
horizontal `orientation`, so `y` is always "along the direction the tree
grows".
