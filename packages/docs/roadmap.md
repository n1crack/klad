# Roadmap

What is here, and what is being worked towards. Order is intent, not a
schedule — nothing below carries a date, and the next release ships when it is
ready rather than when a quarter ends.

## Available now — 1.0

```bash
npm install @klad/core    # or @klad/vue, @klad/react
```

Layout in four orientations with RTL, drawn on a canvas in a Web Worker. Your
own components on the nodes, mounted only where they are readable. Expand and
collapse with the toggled node held still, a minimap, SVG and PNG export,
keyboard navigation with a screen-reader tree, per-node subtree counts, and
go-to-node that opens the way and paints the route.

## Next — drag-and-drop reparenting

Drag a node onto a new parent, with a ghost while you drag and the drop target
lit. A drop that would make a cycle is refused and reported rather than
applied, and only the subtree that actually changed is laid out again.

## Cross-links

Edges that are not tree edges: dotted-line reporting, matrix relationships, a
link between any two nodes — drawn on screen and carried through to the SVG
and PNG exports.

## Alternative layouts

More than one way to arrange the same tree: arrangements that adapt to the
shape of a subtree, and compact forms for the deep narrow chains that make an
org chart taller than a screen.

## Custom and animated edges

Edge shape as something you supply rather than something the library decides,
and motion along a link for charts that show flow as well as structure.

## Child pagination

A manager with hundreds of direct reports shows the first few and a "more"
control, with search to pull specific children into view. Keeps very wide
fan-outs readable — and keeps them out of the layout, where their real cost
is.

## Nested sets

`lft`/`rgt` values exposed and rendered, for data that already stores its tree
that way, plus binary-tree presentation.

---

Something missing, or ordered wrongly for what you are building?
[Open an issue](https://github.com/n1crack/klad/issues) — what people actually
need moves up this list.
