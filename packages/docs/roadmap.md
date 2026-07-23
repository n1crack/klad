# Roadmap

What is here, and what is being worked towards. The order is intent rather
than a schedule: nothing below carries a date, and each release ships when it
is ready.

The direction, in one line: Klad draws org charts today, and is being built
into a **tree rendering engine** — the same canvas pipeline behind file
explorers, ASTs, process trees and family trees. Each version below is a step
that some of those need. Examples land alongside them rather than at the end,
because an example that will not build is the fastest way to find out a
primitive is missing.

## Available now — 1.0

```bash
npm install @klad/core    # or @klad/vue, @klad/react
```

Layout in four orientations with RTL, drawn on a canvas in a Web Worker. Your
own components on the nodes, mounted only where they are readable. Expand and
collapse with the toggled node held still, a minimap, SVG and PNG export,
keyboard navigation with a screen-reader tree, per-node subtree counts, and
go-to-node that opens the way and paints the route.

## 1.1 — Navigating a chart too big to see

The camera can already fit everything and fly to a node. What a chart of tens
of thousands of nodes actually needs is narrower:

- **`fitSubtree(id)`** — frame one department rather than the whole company.
- **`isolate(id)`** — show that subtree and nothing else, with a breadcrumb
  back out. The minimap, the keyboard tree, search and export all follow the
  same root, so an isolated view is a whole view rather than a crop.
- **`getView()` / `setView(view)`** — the camera, what is expanded, and what
  is highlighted, as one serialisable object. That is a shareable link to a
  place in a chart, and a way back to where you were.
- **`follow(id)`** — keep a node fixed on screen while data around it changes.

And **selection**, which the chart has never had: a selected set with its own
events, click, shift-click and ctrl-click, box and lasso. Selection comes
before dragging on purpose — what a person drags is a selection, not a node.

## 1.2 — Layouts as something you choose

Layout becomes an interface rather than one built-in arrangement, so a new one
does not touch the engine and you can supply your own.

The first new arrangement is **indented** — the file-explorer shape, and the
one layout whose width does not explode as a tree grows. It is what an AST
viewer, a folder tree and a deep single-file hierarchy all want. **Loading
children on demand** arrives with it: expanding a node can ask you for its
children instead of requiring the whole tree up front.

## 1.3 — Drag-and-drop reparenting

Drag a node — or a selection — onto a new parent, with a ghost while you drag
and the drop target lit. A drop that would make a cycle is refused and
reported rather than applied, and only the subtree that actually changed is
laid out again.

## 1.4 — Radial layout, and edges you control

A radial arrangement: the root at the centre, generations as rings. It suits
trees that are wide and shallow, where a top-to-bottom chart runs off both
sides of the screen.

With it, edge shape becomes yours: supply your own connector geometry, and
animate along a link for charts that show flow as well as structure. The two
ship together because a radial tree needs curved connectors anyway.

## 1.5 — Very wide fan-outs

A manager with four hundred direct reports, a folder with ten thousand files.
One problem with three faces, and all three are needed: show the first few
with a **more** control, **aggregate** the rest into a single node that says
how many it stands for, and let **search pull specific children into view**.
Keeps wide levels readable — and keeps them out of the layout, where their
real cost is.

## 1.6 — Cross-links

Edges that are not tree edges: dotted-line reporting, matrix relationships, a
link between any two nodes — on screen and carried through to the SVG and PNG
exports. It is also the first half of drawing something that is not a tree at
all.

## 1.7 — Nested sets

`lft`/`rgt` values exposed and rendered, for data that already stores its tree
that way, plus binary-tree presentation.

## 2.0 — Beyond trees

A family tree gives a child two parents. A dependency graph and a git history
both have nodes with several ways in. None of those is a tree, and no amount
of tidy-tree tuning makes them one — they need multi-parent layout and edge
routing that assumes crossings, which is a second layout engine rather than an
option on this one.

That is the version that finishes the sentence at the top of this page, and it
is also where a plugin API belongs — once the seams have stopped moving, so
that extending Klad does not mean rewriting your extension every release.

---

Something missing, or ordered wrongly for what you are building?
[Open an issue](https://github.com/n1crack/klad/issues) — what people actually
need moves up this list.
