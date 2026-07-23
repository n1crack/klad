# Roadmap

Intent, not dated commitments.

## 1.0 — now

Everything documented on this site: the worker-backed canvas pipeline, tidy
layout with four orientations and RTL, LOD tiers, the pooled overlay, the
staged expand/collapse transition with its camera anchor, minimap, SVG/PNG
export, a full keyboard tree, per-node subtree counts, go-to-node with route
highlighting, and the Vue and React bindings.

What remains before the first npm release is publishing itself.

## 1.1 — Drag-and-drop reparenting

Drag a node onto a new parent: a ghost while dragging, the drop target
highlighted, a drop that would create a cycle rejected and reported rather
than applied, and an incremental relayout of only the dirty subtree.

Deferred out of 1.0 deliberately. The interaction is a project in its own
right and 1.0 is otherwise complete; holding the release for it would have
served nobody.

## 1.2 — Cross-links

Edges that are not tree edges: dotted-line reporting, matrix relationships, an
arbitrary link between any two nodes. Touches routing, the renderer and the
export path.

## 1.3 — Alternative layouts

More than one way to arrange the same tree — arrangements that switch by
subtree shape, compact forms for deep narrow chains.

## 1.4 — Animated links, custom edges

Edge styling as a first-class concern: caller-supplied edge shapes, motion
along a link.

## 1.5 — Child pagination

A node with hundreds of direct children shows the first few and a "more"
control, with search to bring specific children into the scene. Keeps very
wide fan-outs readable, and keeps them out of the layout.

## 1.6 — Nested sets

`lft`/`rgt` values exposed and rendered, and binary-tree presentation.
