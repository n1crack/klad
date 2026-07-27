---
title: Layouts
description: Four shapes off one flat array — tiered, indented file rows, radial rings and a drillable sunburst — and how to tune and switch between them.
---

# Layouts

A tree is a tree. What changes between an org chart, a file explorer and a
disk-usage wheel is not the data — it is the shape you draw it in. So `layout`
is an option, and the same `{ id, parentId }` array feeds all four.

```ts
createKlad(host, { data, layout: 'sunburst' })
```

| | For | Grows |
|---|---|---|
| `tidy` | Org charts, decision trees, anything read top-down. The default. | Wide, fast |
| `file` | File explorers, outlines, long lists of nested things. | Down only |
| `radial` | Wide and shallow trees — a root with many branches, each short. | Outward |
| `sunburst` | Proportions: what a branch holds relative to its siblings. | Outward, bounded |

## tidy

The tiered chart: parents above children, siblings side by side, orthogonal
connectors. The only layout `orientation` applies to — `'tb' | 'bt' | 'lr' |
'rl'`, plus `rtl` to mirror sibling order.

Its width grows with the widest level, which for a real org chart is usually
the bottom one. A few hundred nodes is already thousands of pixels across, so
pair it with the minimap and `fitSubtree`.

## file

One indented row per node, with folder guide lines down the indent gutter.

This is the one layout whose width does **not** explode as the tree grows: a
thousand siblings cost a thousand rows, not a thousand columns. If you are
showing something genuinely large and mostly-collapsed, this is the shape that
stays usable.

```ts
createKlad(host, {
  data,
  layout: 'file',
  layoutStep: 18,           // indent per level
  rowGap: 2,                // between rows
  nodeSize: { w: 340, h: 30 },
  toggleOnNodeClick: true,
})
```

A row is your own DOM (see [Node content](/guide/node-content)); what the
canvas contributes underneath is the guide lines, which is the part a DOM row
cannot do without an element per line. Most file lists want
`theme: { nodeFill: 'transparent', nodeStroke: 'transparent' }` so there is no
box behind the row, and `label: () => ''` so the canvas does not draw a second
copy of the name.

::: tip Aligning a trailing column
Rows all keep their declared width, so a size or count column staircases to the
right as the indent deepens. Shrink each row by its own indent to land them on
a common right edge — with a floor, or a deep tree eventually reaches zero:

```ts
nodeSize: (item) => ({ w: Math.max(190, 340 - depthOf(item) * 18), h: 30 })
```
:::

## radial

Root at the centre, each generation a ring further out, every name turned to
run along its own spoke — flipped on the left-hand side so nothing reads upside
down.

Each subtree owns an angular wedge sized by how many leaves it holds, so a
bushy branch gets proportionally more of the circle and siblings never overlap
in angle.

```ts
createKlad(host, {
  data,
  layout: 'radial',
  layoutStep: 190,          // ring spacing
  nodeSize: { w: 18, h: 18 },
  colourBranches: true,
  theme: { cornerRadius: 9, nodeStroke: 'transparent' },
  toggleOnNodeClick: true,
})
```

The natural way to use it is a small marker with the **label** carrying the
content — which is why the ring spacing is set by how much room the names need
rather than by how wide a card is. A node here has nowhere to put a disclosure
control, so `toggleOnNodeClick` is how a viewer folds a branch away.

## sunburst

The tree as a wheel of nested arc segments. Each is sized by its share of the
circle by leaf count, so a parent's arc spans exactly the union of its
children's — the containment you would read down a file tree, read outward
around the circle instead.

Labels are laid on the segments themselves: along the ring where there is room,
outward along the ray where there is not, and skipped where neither fits.
Nothing is ever drawn clipped.

### Drilling in

```ts
chart.api.setCentre('src/lib')   // and `null` to come back to the root
```

The chosen branch widens to the full circle and travels inward while everything
outside it closes at the seam. The camera does not move, because a wheel's frame
does not depend on what is at its centre.

Wire it from `nodeClick`, and make the hub mean "go up":

```ts
chart.on('nodeClick', ({ id }) => {
  const centre = chart.api.getCentre()
  chart.api.setCentre(id === centre ? parentOf(id) : id)
})
```

`getCentre()` plus each node's ancestors is enough for a breadcrumb.

`maxRings` (default 3) sets how many rings are drawn around the centre. Deeper
nodes are still in the tree — drilling in reveals them — which is also what
keeps a very large tree cheap here: the ring window bounds what is painted
regardless of how many nodes there are.

### Colour

On by default, from `theme.palette` — a sunburst's segments have neither
position nor connectors to carry structure, so hue does it. A node takes its
**top-level ancestor's** slot, so a branch keeps its colour as you drill, and
depth steps that hue lighter. See [Theme](/api/theme#branch-colour).

## Changing shape at runtime

`setLayoutOptions` relayouts without replacing the data, so open state and the
camera survive it:

```ts
chart.api.setLayoutOptions({ layout: 'radial' })
chart.api.setLayoutOptions({ layoutStep: value }, { fit: true })
```

The alternative — `update(data, options)` — resets every node's open state,
which makes it useless behind a slider. Pass `{ fit: true }` when a drag ends
to settle the view; every one of these knobs changes how big the drawing is.

## Hidden children

A radial marker is a dot and a sunburst segment is a slice of a ring — neither
has room for a `+`. So a node whose children are all off screen gets a mark
instead: an arc just inside a segment's outer edge, a halo around a marker.

It covers both reasons children can be missing — the branch is closed, or they
fell outside `maxRings` — because those are the same question to whoever is
looking at it.
