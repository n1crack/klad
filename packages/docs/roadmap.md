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

## 1.6 — released: editing, and two things the chart knew but would not say

**Where a node sits.** `nodeSize`, `label`, `collapsedByDefault`,
`mayHaveChildren` and `pinChildren` were each handed the node's data and
nothing else, so none of them could answer a question about depth or about a
node's place among its siblings. A file list, which narrows every row by its
own indent, needs exactly that — and a row that arrived through `loadChildren`
is in no array you could have worked it out from. They all get a second
argument now.

**Which line joins a parent to a child.** Each layout still picks the one that
reads correctly on it, and that stays the default, because a folder guide line
on a tiered chart is a mistake rather than a taste. But `edgeStyle` is a
setting now, so a tidy tree can have straight lines and a chart whose own cards
carry the structure can have none at all.

**Editing.** `move`, `add` and `remove`, through the same door a drop already
used: the open branches survive by id, the camera holds still, and the
difference animates. There is no rename, and there cannot be — a node's text
comes from your `label` reading your own row, so the chart does not know which
field is the name. It owns the shape; you own the content.

- **`canMove`, asked while the pointer is still down.** Refusing in `nodeDrop`
  answers after the viewer has committed: the indicator said yes, then the node
  snaps back. This turns it red under the pointer instead — and binds the API
  too, because a rule only the pointer path honours is a hint.
- **Undo and redo.** A drag that restructures somebody's organisation with no
  way back is a frightening thing to hand a user. `history: false` turns it off
  for an app with its own stack; two stacks make Ctrl+Z a coin toss.
- **The changes, as data.** `changes()` says what has been done since the last
  save and `markSaved()` says it has gone. The log is the product and undo is
  the convenience, which is why the log still works with the history off.

**`reconcile(data)`.** A poll came back, a socket pushed, somebody else moved
something. `update` means "a different tree" and resets the expand state;
`reconcile` means "the same tree, later" and keeps it, along with the camera,
the selection, the filter and the caps you lifted. The difference animates
rather than blinking.

A layout function of your own was planned for this release and dropped. A
function cannot cross into a worker, so it would have meant giving up the
worker or turning the relayout path inside out, and nobody had asked for it.
The connector style was the half worth keeping.

## 1.7 — released: without a pointer, and the small things

Less was missing from keyboard editing than it first looked. A node could
already be moved: `m` picks it up, you navigate, `m` drops it, Escape puts it
back — through the same `nodeDrop` and the same `canMove` as a drag. What it
could not do was **reorder**, because dropping between two things means
pointing at a gap and a list of rows has no gap to point at. `Alt` with the
arrow keys sidesteps that: you do not indicate a position, you say "one up".
`Delete` removes a branch, and `Shift+Enter` asks for a sibling — only asks,
because a new node needs a row and the chart does not know what your rows look
like.

- **`findNext` / `findPrevious`** — walk the search results, bringing each on
  screen. `search` asks a question and changes nothing, `filter` changes what
  the chart is; this is the third thing and neither of those was it.
- **`leafCount` on `stats(id)`** — how many files are in this folder, as
  opposed to how many rows the branch occupies.
- **`viewChange`** — one event for the whole view, instead of subscribing to
  several and merging them back into the picture they came from.
- **`edit`** — every change to the shape, however it was made. A drag reports
  itself through `nodeDrop` and an API call is something you made yourself, but
  a viewer pressing `Alt+Up` restructures the tree with nobody else in the room.

Controlled state was considered for this release and deliberately not built.
Whether a branch is open is a fact about the screen rather than about your
data, and routing every toggle through your store would put a framework render
inside a 16ms interaction — worse, `loadChildren` makes opening a node
asynchronous and data-changing, so that round trip grows a second leg. The
chart keeps holding it and now says what it holds.

## 1.8 — edges worth looking at

A connector is a line and nothing else. There is a case for more: a dashed
line for a relationship that is provisional, a dash that travels to show which
way something flows, a colour that means something.

The line to hold is the one already drawn around `edgeStyle`: **choosing among
answers the chart knows how to draw is a setting; handing over the drawing is
a plugin.** So a small set of styles and a way to say which nodes get them —
not a renderer, and not an animation language.

It ships with a playground example, because an animated edge is the sort of
thing a screenshot cannot argue for.

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
