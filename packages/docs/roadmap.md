---
title: Roadmap
description: 'What has shipped and what is next: layouts, drag and drop, children on demand, very wide levels, and multi-parent graphs.'
---

# Roadmap

The plan, in order. No dates — each release ships when it is ready.

Klad is a tree engine. One canvas, one flat array of `{ id, parentId }`, and
whichever shape suits what you are showing — an org chart, a file explorer, a
taxonomy, a dependency tree. Everything below is about making that one engine
cover more of the ground trees actually occupy.

## 1.0 — released

```bash
npm install @klad/core    # or @klad/vue, @klad/react
```

Four orientations and RTL, drawn on a canvas in a Web Worker. Your own
components on the nodes. Expand and collapse, minimap, SVG and PNG export,
keyboard navigation, a screen-reader tree, per-node subtree counts, and
go-to-node with the route marked.

## 1.1 — released: navigating large charts

- **`fitSubtree(id)`** — frame one branch instead of the whole chart.
- **`isolate(id)`** — show one branch as if it were the whole chart.
- **`getView()` / `setView()`** — camera, open branches and highlight as one
  object. Put it in a URL.
- **Keyboard camera** — arrows pan, `+`/`-` zoom, `f` fits.
- **Selection** — click, ctrl-click, shift-click, box and lasso.

## 1.2 — released: layout is a choice

This is the release that made Klad a tree engine rather than an org chart
component. Layout is something you pick, not something the library assumes. `layout: 'file' | 'radial' | 'sunburst'`
alongside the tiered default, each with the connector style, label placement
and colour treatment that shape actually needs:

- **file** — the file-explorer shape, and the one layout whose width does not
  explode as a tree grows. Indented rows, folder guide lines down the gutter.
- **radial** — root at the centre, generations as rings, names turned to run
  along their own spoke. For trees that are wide and shallow.
- **sunburst** — the tree as a wheel of nested arc segments, coloured by
  branch from a validated categorical palette. Click a segment to drill into
  it: it widens to the full circle and travels inward while the rest closes at
  the seam, and the frame never moves.

Alongside them: `setLayoutOptions` for changing the shape and its tuning live,
a validated categorical palette with per-branch colouring, and a mark on any
node whose children are off screen.

## 1.3 — released: drag and drop

Drag a node, or a selection, onto a new parent — or onto the leading or
trailing quarter of one to drop it beside that node instead. Which axis those
bands run along is the layout's to answer, so a file list offers "between two
rows" and a wheel offers only "into".

A drop into the branch you are carrying is refused: a node cannot become its
own descendant. The move is reported through `nodeDrop` before anything
happens, and `preventDefault()` is how you veto one.

The keyboard has the same move — `m` to pick up, `m` again to drop, announced
through a live region, since a keyboard user gets no drop preview.

The whole visible tree is laid out again on a drop, not just the changed
branch. An earlier draft of this line promised the latter; it was wrong twice
over. `tidy` is a global algorithm whose contour threads run through the whole
forest, so "only the subtree that changed" is not generally correct — moving
one node changes sibling separation all the way up. And it would buy nothing
worth the risk: a full relayout of 20,000 nodes measures 2–12ms, once, and the
existing transition tweens the result for free.

## 1.4 — children on demand

The one thing 1.2 promised and did not deliver. Today a chart needs its whole
tree up front, which rules out the trees where the shape matters most: a file
system you cannot enumerate, a taxonomy behind an API, an org of a hundred
thousand people. Opening a branch should be able to ask for its children and
fill them in, with the node marked as having more below it in the meantime and
the layout settling around the answer rather than jumping to it.

This is first because everything below is easier to justify once a tree can
exceed what fits in memory, and because drag and drop already has a hole shaped
like it — you cannot yet drop into a branch that has not been opened.

## 1.5 — showing less of a large tree

Two problems with the same answer. A manager with four hundred reports or a
folder with ten thousand files needs the first few, a **more** control, and one
node standing in for the rest that says how many it counts. A tree of twenty
thousand nodes needs a way to reduce itself to the nodes that match, keeping
the ancestors that lead to them, so a search is something you can look at
rather than step through.

Nested-set bounds come with it — `lft`/`rgt` on `stats(id)`, computed by the
same walk that already counts descendants. Not as a way of storing a tree, but
as a number you can compare: "is this node inside that branch" stops being an
ancestor walk of unbounded length and becomes `lft > a.lft && rgt < a.rgt`,
which is what makes filtering a large tree by branch cheap enough to do per
frame. They are also what a backend storing categories as nested sets needs
back after a drag reorders them, so the same values close that loop too.

## 1.6 — layouts and edges you supply

`LayoutFn` is already the shape every built-in layout is written to — a pure
`(tree, sizes, opts)` function returning boxes, and optionally the polar
geometry a wheel needs. What is missing is a way to hand your own across the
worker boundary, which a name cannot carry. Edge shape comes with it: which
connector a layout draws is part of that layout's identity, not a separate
setting, and the built-ins already choose theirs this way.

## 2.0 — beyond trees

Family trees, dependency graphs and git histories all give a node several ways
in, and every one of them also wants edges that are not tree edges: a
dotted-line report, a matrix relationship, a link between any two nodes. Both
are the same problem — multi-parent layout with edge routing built for
crossings — and it is a second engine rather than an option on this one. A
plugin API arrives with it.

---

Something missing, or ordered wrongly for what you are building?
[Open an issue](https://github.com/n1crack/klad/issues).
