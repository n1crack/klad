# Klad — roadmap

Owner's plan, recorded 2026-07-22. Versions are intent, not commitments to a
date. The authoritative to-do for the session in progress is
`docs/NEXT-SESSION-TASKS.md`; this is the shape of the releases around it.

## 1.0

Everything currently implemented, plus:

### Per-node counts
Every node must be able to report, cheaply:

- **direct children** — how many children it has,
- **total descendants** — how many nodes hang below it in total,
- **subtree depth** — how many levels deep its own subtree goes.

Plus its own depth from the root, which the tree already carries. These are
O(n) to compute for the whole tree in one pass and must be computed once per
`normalize`, never per frame and never per node on demand — the 50k budget
rules out anything that walks a subtree while drawing.

They are needed by `renderNode`'s context (a card showing "12 direct / 340
total" is the motivating example) and from the imperative API for a caller
doing its own UI.

### Go to a node, opening the way to it
With everything collapsed, "go to node X" must expand the ancestor chain, then
put X on screen. `expandTo` + `focus` already do the two halves; what 1.0 owes
is that this is one call, that it behaves when the whole tree starts collapsed,
and that the confirmation ring on arrival is **optional** — some callers want
the flash as a "you are here", others find it noise.

### Examples
The playground is the shop window, so 1.0 ships more of it:

- a card with a **dropdown** on it,
- a card showing the **counts** above,
- a card whose detail pane **accordions** open on a toggle,
- "go to X" that **marks the path** to X in blue,
- **custom buttons** in a custom node template.

### Release engineering
Build + publish pipeline (see `NEXT-SESSION-TASKS.md`). Publishing to npm
happens after 1.0 is otherwise done, not before.

## 1.1 — Drag-and-drop reparenting

Deferred out of 1.0 (see `NEXT-SESSION-TASKS.md` for the full scope, and for
what core already has: the cycle guard and the designed `reparent` semantics).

## 1.2 — Cross-links

Links that are not tree edges: dotted-line reporting, matrix relationships, an
arbitrary edge between any two nodes. Affects layout (routing), the renderer,
and the export path.

## 1.3 — Alternative layouts

More than one way to arrange the same tree — "smart" layouts that switch
arrangement by subtree shape, compact/stacked forms for deep narrow chains, and
whatever else earns its place.

## 1.4 — Animated links, custom edges

Edge styling as a first-class concern: caller-supplied edge shapes, animation
along a link.

## 1.5 — Child pagination

A node with hundreds of direct children shows the first N and a "more" control.
Beyond that, a combo box with search to add and remove specific children from
the scene. Keeps very wide fan-outs readable, and keeps them off the layout.

## 1.6 — Nested sets / binary tree fields

Expose and render `lft`/`rgt` nested-set values, and support binary-tree
presentation.
