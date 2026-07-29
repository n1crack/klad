---
title: Roadmap
description: 'What has shipped and what is next: layouts, drag and drop, children on demand, filtering, your own layouts, editing with undo, and multi-parent graphs.'
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

## 1.4 — released: children on demand

A chart needed its whole tree up front, which ruled out the trees where the
shape matters most: a file system you cannot enumerate, a taxonomy behind an
API, an org of a hundred thousand people. Now `data` is only what you already
have.

- **`mayHaveChildren`** — a node with no children in `data` is otherwise
  indistinguishable from a leaf, so this is how you say there is more. "May" is
  the honest word: you are answering from a count, and a node that turns out to
  have none simply becomes a leaf.
- **`loadChildren`** — fetches one node's children the first time it is opened.
  The chart keeps what you return; your array stays as you gave it. The node
  opens when they arrive, and the layout settles around them rather than
  jumping.

Asked for once per node, whatever a viewer clicks. A rejection is a
`load-failed` warning and leaves the node unloaded, so the next click retries —
nothing retries on its own. `expandAll()` fetches nothing: "open everything" on
a tree of unknown size is a request nobody means to make.

This also closed the hole 1.3 left. A drag resting on a closed branch springs
it open, and now that includes one that has not been fetched — the children
arrive mid-gesture and the drop preview re-resolves against them.

## 1.5 — released: showing less of a large tree

Two ways a big tree stops being readable, and the numbers that make both cheap.

- **`filter(query)`** — reduce the chart to the nodes that match, keeping the
  ancestors that lead to them, so the result is a tree rather than a list and
  you can see where each hit lives. It opens what it needs to: a filter that
  found something and then left it behind a collapsed branch would be answering
  a different question.
- **`maxChildren` / `pinChildren`** — a level of four hundred draws a handful
  and rolls the rest into one node that says how many it stands for. The cap is
  the budget; the pins are which ones matter, because a cap on its own shows
  whichever children come first and that is nobody's handful. Nothing is thrown
  away — search finds what fell past it, `stats` counts it, and `focus` digs it
  back out.
- **`lft` / `rgt` on `stats(id)`** — nested-set bounds, computed by the same
  walk that already counts descendants. "Is this node inside that branch" stops
  being an ancestor walk of unbounded length and becomes a comparison. The
  classic interleaved numbering, so they can also go straight back to a
  database storing a hierarchy as nested sets.

Along the way a node leaving the chart stopped disappearing between one frame
and the next: it fades out now, the way an arriving one fades in.

## 1.6 — two things the chart knew and would not say

**Where a node sits.** `nodeSize`, `label`, `collapsedByDefault`,
`mayHaveChildren` and `pinChildren` were each handed the node's data and
nothing else, so none of them could answer a question about depth or about a
node's place among its siblings. A file list, which narrows every row by its
own indent, needs exactly that — and a row that arrived through
`loadChildren` is in no array you could have worked it out from. They all get
a second argument now.

**Which line joins a parent to a child.** Each layout still picks the one that
reads correctly on it, and that stays the default, because a folder guide line
on a tiered chart is a mistake rather than a taste. But it is a setting now, so
a tidy tree can have straight lines, and a chart whose own cards carry the
structure can have none at all.

A third thing was planned here and dropped: handing in your own layout
function. A layout cannot cross into a worker — a function does not survive
`postMessage` — so it would have meant either giving up the worker or turning
the relayout path inside out, and nobody had asked for it. The connector style
was the half of that idea worth keeping, and it is a string, so it crosses
without any of that.

## 1.7 — editing, with a way back and a way out

Dragging a node is the only edit there is. Adding one, removing one, renaming,
moving without a pointer — all of it is still you rebuilding your own array and
handing it back, and each rebuild loses the viewer's place unless you are
careful. The chart already does this properly for a drop: it splices, keeps the
open branches by id, and animates the result. That should be something you can
call.

Three things arrive with it.

- **Undo and redo.** A drag that restructures somebody's organisation with no
  way back is a frightening thing to hand a user. Refusing a move before it
  happens is not the same as reversing one after you have seen it.
- **The chart knows when it has unsaved changes.** Ask it, or be told — either
  way, a "you have unsaved work" banner should not be something you have to
  track yourself.
- **The changes, as data.** Read what has been done since the last save and
  send it wherever it goes. When you save is your business, and so is the
  button: the chart holds the edits, it does not decide what to do with them.

## 1.8 — data that keeps arriving

`update(data)` is a reload. It resets the open branches, the children that were
fetched, the levels that were opened up — right for a different dataset, wrong
for the same one again, which is what a poll, a socket or a save comes back
with. `refresh()` covers it only if you changed your array in place, and a host
reading from a server generally has not.

What is missing is a reconcile: match what arrives against what is on screen by
id, keep everything the viewer did, and animate only what actually changed. The
machinery is there — it is what a drop and a fetched branch already do.

## 2.0 — beyond trees

Family trees, dependency graphs and git histories all give a node several ways
in, and every one of them also wants edges that are not tree edges: a
dotted-line report, a matrix relationship, a link between any two nodes.

Both are the same problem — a node can be reached more than one way, so
position stops being decided by a single parent and lines start crossing on
purpose rather than by accident. That is a second engine, not an option on this
one, which is why it is a major version and not a minor: everything a tree
takes for granted, from "one parent" to "no cycles" to "a subtree is
contiguous", stops being true.

What carries over is everything above it — the canvas, the worker, your own
components on the nodes, and the API for moving around.

---

Something missing, or ordered wrongly for what you are building?
[Open an issue](https://github.com/n1crack/klad/issues).
