# Roadmap

The plan, in order. No dates — each release ships when it is ready.

Klad draws org charts today. It is being built into a general tree renderer:
the same canvas behind file explorers, ASTs and family trees.

## 1.0 — available now

```bash
npm install @klad/core    # or @klad/vue, @klad/react
```

Four orientations and RTL, drawn on a canvas in a Web Worker. Your own
components on the nodes. Expand and collapse, minimap, SVG and PNG export,
keyboard navigation, a screen-reader tree, per-node subtree counts, and
go-to-node with the route marked.

## 1.1 — navigating large charts

- **`fitSubtree(id)`** — frame one branch instead of the whole chart.
- **`isolate(id)`** — show one branch as if it were the whole chart.
- **`getView()` / `setView()`** — camera, open branches and highlight as one
  object. Put it in a URL.
- **Keyboard camera** — arrows pan, `+`/`-` zoom, `f` fits.
- **Selection** — click, ctrl-click, shift-click, box and lasso.

## 1.2 — more layouts

Layout becomes something you choose, and can supply yourself. First up:
**indented**, the file-explorer shape, and the one layout whose width does not
explode as a tree grows. Children can be loaded on demand as branches open.

## 1.3 — drag and drop

Drag a node, or a selection, onto a new parent. A drop that would make a cycle
is refused and reported. Only the subtree that changed is laid out again.

## 1.4 — radial layout and custom edges

Root at the centre, generations as rings — for trees that are wide and shallow.
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

## 2.0 — beyond trees

Family trees, dependency graphs and git histories all give a node several ways
in. That needs multi-parent layout and edge routing built for crossings — a
second layout engine rather than an option on this one. A plugin API arrives
with it.

---

Something missing, or ordered wrongly for what you are building?
[Open an issue](https://github.com/n1crack/klad/issues).
