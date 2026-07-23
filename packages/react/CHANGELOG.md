# @klad/react

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
  - @klad/core@1.1.0

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
  - @klad/core@1.0.0
