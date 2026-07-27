---
title: Roadmap
description: 'What has shipped and what is next: layouts, drag and drop, very wide levels, cross-links, and multi-parent graphs.'
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

Children loaded on demand as branches open is still to come.

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

## 1.4 — custom edges

Edge shape becomes yours to supply, with motion along a link for charts that
show flow as well as structure.

## 1.5 — very wide levels

A manager with four hundred reports, a folder with ten thousand files: show the
first few with a **more** control, aggregate the rest into one node that says
how many it stands for, and pull specific children into view with search.

## 1.6 — cross-links

Edges that are not tree edges: dotted-line reporting, matrix relationships, a
link between any two nodes — on screen and in the exports.

## 1.7 — nested sets

`lft`/`rgt` values exposed and rendered, plus binary-tree presentation.

## 1.8 — layouts you supply

`LayoutFn` is already the shape every built-in layout is written to — a pure
`(tree, sizes, opts)` function. What is missing is a way to hand one in across
the worker boundary, which a name cannot carry. Once that lands, your own
layout is a first-class one.

## 2.0 — beyond trees

Family trees, dependency graphs and git histories all give a node several ways
in. That needs multi-parent layout and edge routing built for crossings — a
second layout engine rather than an option on this one. A plugin API arrives
with it.

---

Something missing, or ordered wrongly for what you are building?
[Open an issue](https://github.com/n1crack/klad/issues).
