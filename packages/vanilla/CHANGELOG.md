# @klad/core

## 1.2.0

### Minor Changes

- ae1e116: The wheel layouts now show when a node is hiding something.

  A radial marker is a dot and a sunburst segment is a slice of a ring — neither
  has room for a disclosure control, so a collapsed branch there looked exactly
  like a leaf. The chart was omitting the fact that there was more, which is
  worse than showing less.

  Nodes whose children are all off screen now carry a mark: a second arc just
  inside a segment's outer edge, a halo around a radial marker. "Off screen"
  covers both reasons a wheel has — the branch is closed, or its children fell
  outside `maxRings` — because those are one question to a viewer and get one
  answer. It is computed once per relayout (`Frame.hasHidden`), not per frame,
  and the array is `null` whenever nothing is hiding anything, which is the whole
  steady state of a fully expanded chart.

  The SVG and PNG exports draw it too.

  The `radial` layout also gains `toggleOnNodeClick` in the playground's preset:
  paired with the mark, it gives a viewer a way to open and close branches on a
  chart whose nodes are too small to hold a button.

- 84df523: `setLayoutOptions(settings, opts?)` — change how the tree is arranged after
  construction, without the tree-state reset `update(data, options)` causes.

  The shape itself and every knob that tunes it: `layout`, `layoutStep`,
  `rowGap`, `maxRings`, `colourBranches`, `spacing`, `orientation`, `rtl`. The
  same paint-only discipline `setTheme` and `setMinimap` already follow — this
  is the layout-shaped hole in that set. Dragging an indent slider is not a
  reason to re-collapse a tree the viewer just opened.

  The camera does not move by default, because a chart that jumped to a fit on
  every tick of a slider is unusable as a control. Every one of these knobs does
  change how big the drawing is, though, so pass `{ fit: true }` to settle the
  view once a drag ends; the fit is queued and happens after the relayout lands,
  rather than against the bounds it is about to replace.

  `LayoutSettings` is exported (and re-exported from the React and Vue
  adapters), as are `DEFAULT_PALETTE`/`DARK_PALETTE` and `LayoutName`.

- beb8dc3: Layout is now something you choose: `layout: 'tidy' | 'file' | 'radial' | 'sunburst'`.

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

### Patch Changes

- Updated dependencies [ae1e116]
- Updated dependencies [84df523]
- Updated dependencies [beb8dc3]
  - @klad/engine@1.2.0

## 1.1.0

### Minor Changes

- c44e9db: `data` is now the only option without a default.

  `nodeSize` defaults to `{ w: 180, h: 64 }` — a readable name-and-role card at
  1:1, exported as `DEFAULT_NODE_SIZE` for anyone sizing their own cards around
  it. `label` defaults to whichever of `name`, `label` or `title` a node
  actually carries, falling back to its `id`.

  ```ts
  createKlad(host, { data }); // a working chart
  ```

  Both were required before, and neither had to be: the first was a number
  almost every chart set to something similar, and the second was a one-line
  accessor over a field the data was already using. Between them they made the
  smallest possible chart three options long and made a missing label look like
  a rendering fault rather than a setting. Explicit values behave exactly as
  before — including `label: () => ''` for a node that should stay blank.

- 96b337f: `isolate(id)` — show one branch as if it were the whole chart.

  `fitSubtree` points the camera at a branch and leaves the rest of the chart
  where it was, off screen. `isolate` re-roots the tree: that node becomes the
  root and everything else stops existing as far as layout, hit-testing, the
  minimap, the keyboard tree, search and export are concerned. On a chart of tens
  of thousands of nodes that is the difference between a tight camera on a big
  chart and a small chart.

  `isolate(null)` restores the whole tree. `getState().isolated` reports it, and
  a saved view carries it, so a link can open someone else on the same branch.
  Where the viewer is inside the whole tree is left to the host to say —
  `pathTo(id)` returns the chain from the real root, which is a breadcrumb.

- 29ecb6e: Keyboard control of the camera, `fitSubtree(id)`, and saveable views.

  **Keyboard.** Clicking a chart and pressing an arrow key used to do nothing:
  the host was not focusable and no key was bound outside the hidden
  accessibility tree, so the only way in was fourteen presses of Tab. The chart
  is now a tab stop — the first one inside itself — and answers to arrows (Shift
  for a stride), `+`/`-`, `f`, `0`, `Home` and `Esc`. Keys are left alone when
  focus is inside an input, a `<select>`, or a row of the accessibility tree,
  which has its own arrows for moving between nodes rather than moving the view.
  `keyboard: false` opts out, including the tab stop.

  **`fitSubtree(id)`.** Frames one branch rather than the whole chart. On a chart
  of tens of thousands of nodes, fitting everything means a zoom level where
  nothing can be read; "show me Engineering" is the question people have.

  **`getView()` / `setView(view)`.** Where a viewer is — camera, open branches,
  highlight — as one plain serialisable object naming nodes by id. Put it in a
  URL and you have a link to a place in a chart; ids that have since left the
  tree are ignored rather than throwing, so an old bookmark still opens.
  `ChartState` gained `highlighted` for the same reason.

- 06e2340: Selection: `select(ids)`, `getSelection()`, a `selectionChange` event, and
  pointer selection behind `selection: true`.

  What the viewer picked, kept separate from what `highlight` says the chart is
  pointing at. The two co-occur constantly — select three people, then search —
  so they are stored separately and drawn differently, through new
  `selectionStroke` / `selectionStrokeWidth` theme tokens. A selected node keeps
  its own outline underneath and is drawn at every zoom, including the tier where
  unselected nodes are shapes.

  With `selection: true`, the pointer selects: click replaces, ctrl/cmd-click
  toggles one, shift-click adds, shift-drag draws a box, alt-drag draws a lasso,
  a click on the background clears, and `Esc` clears both selection and
  highlight. Off by default, because a chart written before this existed already
  has a meaning for a click.

  Also fixes the minimap after `isolate`: it held its old frame, so an isolated
  branch was drawn at the whole chart's scale, in the corner the whole chart used
  to occupy.

### Patch Changes

- Updated dependencies [c44e9db]
- Updated dependencies [96b337f]
- Updated dependencies [29ecb6e]
- Updated dependencies [06e2340]
  - @klad/engine@1.1.0

## 1.0.0

### Major Changes

- 94c71aa: First release.

  A framework-agnostic org chart for trees far too large to give a DOM node each.
  Layout and drawing happen on a `<canvas>` inside a Web Worker; real components
  are mounted only for the nodes that are both on screen and zoomed in far enough
  to read — about fifty at a time, pooled and reused. 5,000–50,000 nodes at
  60fps.

  - **Layout** — tidy tree in four orientations, RTL, per-node sizes, and a
    staged expand/collapse transition that keeps the toggled node pinned to the
    pixel it was on.
  - **Your components on top** — a Vue `#node` slot, a React render prop, or
    plain DOM. Each node's context carries its own subtree counts, precomputed
    once per tree rather than counted while drawing.
  - **Navigation** — `focus` opens the way to a node before centring on it,
    `pathTo` + `highlight` paint the route from the root, plus search, a full
    keyboard tree, a screen-reader tree, and a minimap that holds its frame
    steady across a toggle.
  - **Export** — SVG and PNG, drawn from the same geometry as the canvas.
  - **Themeable** — every colour, weight and radius the canvas uses, live
    through `setTheme`, with `DEFAULT_THEME` and `DARK_THEME` ready to spread.
  - **Gestures** — drag to pan with momentum, wheel to zoom, pinch on touch. The
    chart claims exactly the gestures it uses and leaves the rest, right-click
    included, to you.

  ESM only. TypeScript throughout.

### Patch Changes

- Updated dependencies [94c71aa]
  - @klad/engine@1.0.0
