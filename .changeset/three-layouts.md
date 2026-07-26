---
'@klad/engine': minor
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

Layout is now something you choose: `layout: 'tidy' | 'file' | 'radial' | 'sunburst'`.

Each of the three new shapes brings the treatment it actually needs, rather
than being the tiered chart with the boxes moved:

- **`file`** — the file-explorer shape, and the one layout whose width does not
  grow with the tree. One indented row per node, with folder guide lines down
  the indent gutter. `layoutStep` sets the indent, `rowGap` the space between
  rows.
- **`radial`** — root at the centre, each generation a ring further out, every
  name turned to run along its own spoke and flipped on the left-hand side so
  nothing reads upside down. `layoutStep` sets the ring spacing.
- **`sunburst`** — the tree as a wheel of nested arc segments, each sized by
  what it holds. Labels are laid on the segments themselves — along the ring
  where there is room, outward along the ray where there isn't, and skipped
  where neither fits, so nothing is ever drawn clipped.

**Drilling into a sunburst.** `setCentre(id)` — or the `centre` option —
re-centres the wheel on one node: it widens to the full circle and travels
inward while everything outside it closes at the seam, over about 600ms. This
is deliberately not `isolate`. Nothing is pruned, so every node has a before
and an after and the change animates rather than cuts; the wheel's frame does
not depend on what is at its centre, so the camera never moves. `getCentre()`
and each node's ancestors are enough to build a breadcrumb. `maxRings` sets how
many rings are drawn around the centre.

**Colour.** Nodes can be filled by which top-level branch they belong to, from
a validated eight-hue categorical palette (`theme.palette`, with a dark set to
match). On by default for the sunburst, whose segments have neither position
nor connectors to carry structure; off everywhere else, and `colourBranches`
overrides either way. Hues are assigned in fixed order and never cycled — a
ninth branch takes a neutral rather than repeating slot one — depth steps the
branch's own hue lighter in OKLab, and each label's ink is chosen against the
fill actually behind it.

Connectors follow the layout: the tiered elbow for `tidy`, folder spines for
`file`, straight spokes for `radial`, none at all for `sunburst`. All of it —
shapes, sector geometry and label placement — is shared between the canvas and
the SVG/PNG export, so an export still matches what is on screen.

`orientation` continues to apply to `tidy` only; a file list is a vertical list
of rows whatever you set, and a wheel has no reading direction.

Also fixed: an `lr`/`rl` chart exported to SVG or PNG drew every card with its
width and height swapped.
