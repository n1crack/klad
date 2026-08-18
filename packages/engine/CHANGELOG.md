# @klad/engine

## 1.11.1

## 1.11.0

### Minor Changes

- 217d4f2: Six theme tokens for a chart worth looking at, and a hook for the cards on top
  of it. Every one of them defaults to what the chart already drew.

  ```ts
  createKlad(el, {
    data,
    colourBranches: true,
    theme: {
      edgeBranchColours: true, // a connector in the colour of the node it leads to
      edgeHighlightRecolours: false, // …and it keeps that colour while lit
      edgeHighlightGlow: 3, // a halo under the lit route, in screen pixels
      nodeBranchColours: false, // the cards are your own DOM; leave the boxes alone
      hiddenMark: false, // and they say "more inside" their own way
      gridDot: 'rgba(128, 132, 148, 0.3)', // a dot grid, painted on the canvas
      gridSpacing: 26,
      gridDotSize: 1,
    },
  })
  ```

  - `edgeBranchColours` takes the CHILD's own fill rather than a branch base
    colour, so a branch reads as one family shading away from the root. Drawn as
    one stroked path per distinct colour — the cost is the palette's size, not
    the edge count.
  - `edgeHighlightRecolours: false` is what makes that worth having: recolouring
    a lit route throws away which branch it is at the moment somebody is asking.
    A highlight now also fades in and out rather than switching on.
  - `gridDot` and its two sizes draw the grid on the canvas rather than behind
    it. A grid in CSS is composited from a style the page updates after the fact,
    while the diagram comes from the camera the frame was rendered with — so it
    lags a frame behind on every pan. Here it is one draw from one camera.
  - The overlay root carries `data-klad-moving` while the chart animates. A
    toggle slides every card under a pointer that has not moved, so the browser
    fires `:hover` on each one in turn; the attribute is how your CSS can decline
    to animate on that.

- 217d4f2: `weight` — a sunburst whose sectors are sizes, not counts.

  ```ts
  createKlad(el, {
    data,
    layout: 'sunburst',
    weight: (item) => Number(item.sizeKb ?? 0),
  })
  ```

  Until now every leaf took an equal slice of its parent's arc, so a 1 KB config
  file and a 480 KB bundle drew the same sector — a picture of the directory
  listing rather than of the disk. `weight` is read on the LEAVES; a parent's
  share is the sum of what is under it whatever the function returns for the
  parent itself, because that is the only definition under which a ring is
  exactly the union of the ring outside it.

  Zero, negative and non-finite all count as zero: a leaf worth nothing gets no
  arc, which is the honest picture. There is no per-leaf default of `1` — that is
  only neutral against leaf COUNTS, and against real weights it is an arbitrary
  quantity in somebody else's units. A tree where nothing is worth anything falls
  back to counting instead, so a `weight` wired to a field the data does not have
  degrades to the unweighted wheel rather than to an empty one.

  Two more pieces that go with it:

  - **`nodeHighlightRecolours`** and **`highlightLift`** — a lit node can keep
    its own fill and get brighter instead of being repainted in `highlightFill`.
    On a wheel a sector's colour is which branch it belongs to, so flooding it
    with one accent answers "which one is the pointer on" by deleting the answer
    to "what is it". The lift is a shift in OKLab lightness, so one number is the
    same perceived step on a pale leaf and a saturated root.
  - **`chart.api.overflow(id)`** — what an aggregate node stands for, reachable
    without rendering one. A canvas-only chart has no `renderNode` to read
    `NodeContext.overflow` from, and "what is inside this +42" is a fair question
    to ask about a sector you can see.

  Two fixes that came with it:

  - `toSVG`/`toBlob`/`print` lay the tree out again from scratch rather than
    reading the engine's geometry, and were not given the weights — so an
    exported wheel divided its arcs by leaf count while the one on screen divided
    them by size. Same for worker mode, where the weights never reached the
    message at all.
  - A cap no longer invents an aggregate node to stand for exactly ONE child. It
    took the room the child would have taken, said strictly less, and cost a
    click to get back what was already there.

### Patch Changes

- 217d4f2: The radial's "more inside" mark reads as a mark again. At three pixels out from
  the marker, half transparent and in the marker's own colour, it looked like a
  soft edge on the dot rather than a second thing — which is the one reading it
  must not have. It is now clear of the marker with a visible gap inside it.

## 1.10.0

### Minor Changes

- e65d2f3: Expand/collapse fixes.

  - The toggled node now stays where it was clicked for the whole transition: a click, a hand-drift or a drag can no longer walk the camera off, and rapid clicking cannot ratchet it away.
  - A click resolves against what is on screen, not the layout the chart is heading for, so it toggles the card you aimed at mid-animation.
  - Children caught mid-reveal or mid-collapse are carried at the position they were drawn at, instead of jumping to full size or onto their parent's box.
  - Children grow out of the tip below their own parent, at every depth.
  - Siblings pack the same distance apart whichever one has children.
  - The two animation phases overlap more, so an open or close reads as one move (450ms → 390ms).

## 1.9.1

## 1.9.0

## 1.8.0

### Minor Changes

- b217f4b: `edgeStyle: 'bezier'` — a curved connector.

  ```ts
  createKlad(el, { data, edgeStyle: 'bezier' })
  ```

  The same two ends a `'tiered'` elbow joins, with a curve in between instead of
  a right angle. It leaves the parent and enters the child square-on, so a run of
  siblings still reads as one fan rather than as lines pointing at each other,
  and it honours `orientation` the way the elbow does.

  The one style no layout asks for, which is the point: every other value is some
  layout's own idea of a connector. This is there for a chart that wants a softer
  line.

  The SVG export draws the same curve from the same control points, and the
  culler needs no special case — the control points sit inside the rectangle the
  two ends span, so the box that bounded an elbow bounds this too.

- 8f102d8: `edgeFlow` — a travelling dash on the branches that are live.

  ```ts
  createKlad(el, {
    data,
    edgeFlow: (parent, child) => child.status === 'active',
  })
  ```

  For a flow, a dependency, a route that is carrying something. Asked once per
  node when the data changes, never per frame. Colour, weight, dash pattern and
  speed are theme tokens (`edgeFlowStroke` and friends).

  **It keeps the chart drawing, and that is why it is a predicate rather than a
  switch.** Everything else here renders only when something changes — an idle
  chart costs nothing at all. A travelling dash has to advance every frame, so
  for as long as one marked edge is in the visible tree the loop keeps going.
  Marking one branch is cheap; marking everything is a decision about somebody's
  battery. Collapse a branch and its edges stop counting.

  Exports draw them as ordinary connectors: a dash frozen mid-travel in a still
  is just an odd-looking gap. Reduced motion is left to you to honour, because
  whether a flow still means anything standing still depends on what you are
  using it for — the docs show the media query.

  The playground has a **Flowing edges** example.

### Patch Changes

- 28b7239: Flowing edges stop animating when you zoom out past the point where a dash is
  visible.

  At the `block` tier a connector is a couple of pixels and a dash is smaller
  than one, while dashed stroking costs the rasteriser real work per segment —
  so on a large chart that was thousands of edges paying, sixty times a second,
  for something nobody could see. They are drawn as ordinary lines there, and
  the chart stops asking for frames at all.

  The same rule the elbow radius already follows, for the same reason.

  Measured on 20,000 nodes with every edge flowing, which is not a sensible
  setting: 19 frames in 400ms close up, and 0 zoomed out.

## 1.7.0

### Minor Changes

- 89a07b5: Walking the search results, counting leaves, and two events that were missing.

  ### findNext / findPrevious

  ```ts
  chart.api.findNext('rossi') // start, and go to the first
  chart.api.findNext() // the next
  chart.api.findPrevious() // back one
  ```

  `search` answers a question and changes nothing; `filter` changes what the chart
  is. This is the third thing and neither of those does it: keep the whole tree in
  front of me and take me to the next hit. Each call brings the node on screen,
  opening whatever it was folded behind, and wraps at the end rather than stopping.

  Any change to the tree forgets where it was — a place in a list of nodes that
  have since moved is not a place.

  ### leafCount on stats(id)

  ```ts
  chart.api.stats('src')!.leafCount // how many files, at any depth
  ```

  A different question from `descendants`, and usually the one being asked: "how
  many files are in this folder" rather than "how many rows does this branch
  occupy". Filled by the same sweep that already totals the descendants, so it
  costs nothing, and it leaves out the nodes a capped level invents exactly as the
  other counts do.

  ### filterChange and layoutChange

  ```ts
  chart.on('filterChange', ({ query, matched }) => (count.textContent = `${matched.length}`))
  chart.on('layoutChange', ({ settings }) => mirror(settings))
  ```

  `layoutChange` carries the settings as they now stand rather than the delta, so
  a sidebar mirroring the chart reads what IS instead of what it last sent. A knob
  nobody has set is absent rather than `undefined`, so spreading the payload over
  your own state does not punch holes in it.

  `filterChange`'s `query` is `null` both for no filter and for a predicate, which
  cannot be written down — the same limit `getView` states.

  ***

  A general camera-animation API was considered and is not here, because it
  already exists: `setView(view, { animate: true })` flies to any camera, and
  `focus(id)` is the "go to this node" case with the ancestors opened on the way.

## 1.6.0

### Patch Changes

- 57142dd: Two bugs where a source index outlived the tree it meant something in.

  **Isolating a branch, then changing the data, isolated the wrong branch.**
  `isolate` held a source index, and a source index means nothing once the tree
  is rebuilt — so a drag-and-drop, a lazily-loaded branch, a cap change or an
  edit left the chart framing whichever node inherited the old slot, and
  reporting that node's id back through `getState().isolated`. It is held by id
  now and resolved on every rebuild, alongside the filter and cap masks that were
  already re-derived for exactly this reason. If the isolated node leaves the
  tree, the chart shows the whole tree rather than an arbitrary branch.

  **A rebuild that both reordered the data and took nodes out of view could crash
  the relayout.** The engine's transition builder reads the previous tree in the
  old index space and the maps it looks things up in are keyed by the new one.
  Mixing them is invisible until both happen at once — a drop reorders but
  nothing leaves the view, a collapse has things leave but does not reorder —
  and then a fading node is looked up under another node's key: usually it fades
  from the wrong place, and when the key is missing entirely the box comes back
  `undefined` and reading it took the whole frame down. Isolating and then
  reconciling does both.

## 1.5.1

### Patch Changes

- 82e5875: Three things behind a freeze reported on iOS.

  **The tap that closed the picker also started a pan.** A popover's dismissing
  tap should dismiss and nothing else; this one reached the chart underneath and
  began a gesture. If anything then ate its `pointerup` — which dismissing a
  popover on a phone is very good at — the chart was left following the finger
  with no way out. The dismissal now consumes the press.

  **"Go to node" was listing nine thousand options.** It is a plain `<select>`
  with one entry per node, which is fine on the example it was built for and not
  fine on a dataset of that size — a DOM cost on every mount, and on a phone a
  native picker nobody can scroll. The wide-levels example drops it; it already
  has a searchable picker that builds only the rows in view.

  **A worker error froze the chart permanently.** When the worker threw, it
  reported the error and never sent the frame that had been asked for — so the
  main thread waited on a promise that could not settle, and since the frame loop
  only asks for its next frame after that promise resolves, one error ended the
  animation loop for good. It resolves now, with an empty frame, and the loop
  carries on. Two renders in flight at once had the same shape and the same fix.

## 1.5.0

### Minor Changes

- 433c79c: Cards fade out when their node leaves, instead of vanishing.

  The canvas has faded leaving nodes since 1.0 — a collapse's children shrink
  back into their parent — but the host's DOM overlay never heard about them.
  They are not in `visible` and never will be, so a chart with real cards on it
  faded a box on the canvas while the card sitting on that box blinked out on the
  first frame.

  Nowhere was that worse than a capped level. Pinning somebody below the cap does
  not widen the level, it takes the slot off whoever was last — so two cards
  swapped in one place, one vanishing instantly and one fading in. What it read
  as was the whole chart re-rendering, which is exactly how it was reported.

  The engine now exposes `lastGhostSource`, `lastGhostBoxes` and
  `lastGhostAlpha`: the nodes on their way out this frame, their interpolated
  boxes and their alphas, three aligned arrays. `null` together on every frame
  where nothing is leaving, and bounded by how many actually are — so the steady
  state is untouched, the same way `lastDrawnBoxes` is. They cross the worker
  boundary transferred rather than cloned, like their siblings.

  The vanilla overlay folds them into the same box and alpha maps it already
  keeps, so a leaving card animates exactly as an arriving one does. Every
  collapse gets this too, not just a capped level.

- a854c03: `filter(query)` — reduce the chart to what matches.

  ```ts
  const found = chart.api.filter('schema') // the ids that matched
  chart.api.filter(null) // back to the whole tree
  ```

  A substring on the label, or your own predicate. What stays is the matches
  plus the ancestors that lead to them, so the result is a tree rather than a
  list and you can see where each hit lives. A match's own children are hidden
  unless they match too: answering "where are the things I asked for" with their
  subtrees attached puts back most of what was taken away.

  It overrides collapse. A filter that found something and then left it hidden
  behind a closed ancestor would be answering a different question than the one
  that was asked. Expand state is untouched underneath and comes back when the
  filter is cleared.

  Like `isolate`, this prunes and lays out again rather than hiding nodes at draw
  time — so the minimap, the screen-reader tree, drop resolution and the exports
  all agree with what is drawn, without any of them learning about filtering.
  Under a filter the keyboard's right arrow moves inward rather than expanding,
  since the mask has already decided what is on screen.

  The engine's half is `setFilter(keep)`, a source-indexed mask. Working out what
  matches, and which ancestors lead to it, stays with the caller: matching is a
  question about their data, which the engine addresses by index and cannot see.

  Also corrected: `isolate`'s documentation claimed it constrained `search`. It
  never has. `search` deliberately scans the whole tree — including branches that
  are collapsed, isolated away or filtered out — because "is there a Rossi
  anywhere in this company" is not a question about the current view, and a
  search that could only find what was already on screen would be no use for
  getting to what is not. That is now what the docs say, and `search`'s own
  docblock says why.

- fec4c77: Fixed: a move had no transition in worker mode.

  The worker renders after every message. The vanilla layer sent the filter and
  cap masks as their own calls right after `setData`, so the relayout that built
  the move's transition was followed immediately by one that dirtied the layout
  and threw it away. On the main thread both land inside a single frame and one
  relayout sees everything — which is why nothing caught it: every test for this
  ran the engine in-process.

  The masks now travel with the data, as two more optional arguments to
  `setData`. They are indexed against that tree and belong in the same breath as
  it. `setFilter` and `setOverflow` remain for changing either without a data
  change.

  What this fixes in practice: pinning a node onto a capped level animates. The
  card that lost its slot fades out while room is being made; the pinned one
  fades in after. Before, in a worker-backed chart — which is the default — both
  happened between one frame and the next.

- 36e1a49: `stats(id)` now carries nested-set bounds: `lft` and `rgt`.

  A node's pair brackets every pair below it, which turns "is this node inside
  that branch" from a walk up the parent chain of unbounded length into two
  comparisons:

  ```ts
  const branch = chart.api.stats('engineering')!
  const node = chart.api.stats('lead-42')!
  const inside = node.lft > branch.lft && node.rgt < branch.rgt
  ```

  That is what makes filtering a large tree by branch cheap enough to do per
  frame, which is what they are here for. Strict on both sides, so a node is not
  inside itself, and `rgt - lft` is `2 * descendants + 1`, so the pair carries
  the subtree size too.

  The classic interleaved numbering rather than a half-open range, because it is
  also what a database storing a hierarchy as nested sets uses — so these can go
  straight back after a drag reorders anything. Numbered across the whole forest,
  so two roots' ranges never overlap.

  Free, in the sense that matters: computed by the same `computeSubtreeStats`
  pass that already counts descendants, as a flat sweep over the existing
  preorder rather than the enter/exit recursion the numbering is usually
  described with. A 50,000-deep chain is a supported input and there is a test
  that would blow the stack if this stopped being a sweep.

  The six numbers are also on the context every card is rendered with, since
  `NodeContext extends NodeStats`.

- 89233a3: Very wide levels: `maxChildren` and `pinChildren`.

  ```ts
  createKlad(host, {
    data,
    maxChildren: 8,
    pinChildren: (item) => watching.has(String(item.id)),
  })
  ```

  Eight children are drawn as themselves and everything after them is replaced
  by a single node saying how many it stands for.

  Two options rather than one, because a cap on its own is a truncation and
  truncation shows whichever children come first. Working through five levels of
  a hundred where seven or eight per level matter, that is nobody's eight.
  `pinChildren` says which. Pins precede the budget rather than being part of it
  — pin ten with a cap of eight and you get ten, because a pin is an instruction
  and a cap is a default — and order stays the data's own, so a pinned child does
  not get hoisted to the front.

  **Nothing is thrown away.** The children that did not fit are still in the
  tree: `search` finds them, `stats` counts them, `filter` matches them, and
  `focus` digs one back out. That last is not a nicety — a cap has no toggle the
  way a collapsed branch does, so without it a node whose ancestor fell past a
  cap would be permanently unreachable.

  `NodeContext.overflow` is `null` on ordinary nodes and on the aggregate carries
  `count`, the `ids` it stands for, and `showMore()` / `reveal(ids)` bound to that
  node — so a card, or a picker built from `ids`, is self-contained rather than
  having to reach back out for the chart instance from inside a render callback.
  `showMore` and `reveal` are also on the chart API. A lift sticks: somebody
  asked for it and a rebuild is not an undo.

  A filter suppresses capping entirely, since asking for specific nodes has
  already said which ones you want.

  The engine's half is `setOverflow(hide)`, a source-indexed mask. Hidden rather
  than absent is the load-bearing choice: only the drawn tree is smaller, which
  is what lets every other claim above be true.

## 1.4.0

### Minor Changes

- 4585c84: Children on demand — a chart no longer needs its whole tree up front.

  ```ts
  createKlad(host, {
    data: roots,
    mayHaveChildren: (item) => Number(item.childCount) > 0,
    loadChildren: (item) => fetch(`/api/children/${item.id}`).then((r) => r.json()),
  })
  ```

  Two options rather than one, because the chart can only know what it has been
  given: a node with no children in `data` is indistinguishable from a leaf, so
  something has to say there is more before anything can be fetched.
  `mayHaveChildren` is that something, and "may" is honest — you are answering
  from a count, and a node that turns out to have none becomes a leaf.

  The chart keeps what `loadChildren` returns; your array stays as you gave it. A
  `childrenLoaded` event fires if you want to persist it. An unloaded node starts
  CLOSED whatever `collapsedByDefault` says — "open" is a claim about what is on
  screen, and opening it is the only thing that ever asks for the load. It opens
  when the children arrive, in the same relayout that brings them, and the node
  you clicked holds its place while the tree grows underneath it.

  Asked for once per node however hard a viewer clicks. A rejection is a
  `load-failed` warning and leaves the node unloaded, so the next click retries;
  nothing retries on its own. `expandAll()` and `expand(id, true)` fetch nothing.

  `NodeContext.loading` says which node is waiting — what a card looks like while
  it waits is a decision about your card. `NodeContext.hasChildren` is true for an
  unloaded node, so your own chevron appears on it, and the screen-reader tree
  gets the same answer, which is what makes these branches reachable without a
  pointer.

  Also new in the engine: the "more inside" mark now draws for the rectangular
  layouts. It was computed for every layout and painted only for the wheels, so a
  collapsed branch on a tidy or file chart said nothing at all below the zoom
  where cards are drawn. It is a short stub leaving the node the way its first
  connector would, ending in a dot — and it is what an unloaded node carries.

## 1.3.1

## 1.3.0

### Minor Changes

- 6f61f1d: Drag and drop — `dragAndDrop: true`.

  Drag a node onto another to reparent it, or onto the leading or trailing
  quarter of one to drop it beside that node instead. A reparent that could only
  say "into" is half a feature: reordering siblings is most of what anyone does
  with a file list.

  Which axis those bands run along is a question only the layout can answer, so
  it asks. A file list stacks downward whatever `orientation` says; a tidy chart
  puts siblings across its growth axis; a wheel offers `into` and nothing else,
  because sibling segments are arranged by angle and "three degrees
  anticlockwise" is not a position anyone is pointing at.

  Dropping into the branch you are carrying is refused — a node cannot become
  its own descendant — and shown in the refusal colour rather than not shown,
  since an absence cannot tell "not allowed" apart from "not pointing at
  anything". The check is one array read per pointer move, from a subtree mask
  built when the drag starts.

  The move is reported through `nodeDrop` BEFORE anything happens; call
  `preventDefault()` to refuse it. Dragging a selected node carries the whole
  selection. The chart applies the move to its own copy of the data rather than
  mutating the array you handed it, so reconcile your own store from the event.

  New theme tokens: `dropStroke`, `dropRefusedStroke`, `dropStrokeWidth`. New
  core exports for anyone building their own gesture layer: `resolveDropMode`,
  `isDropAllowed`, `subtreeMask`, `dropPosition`.

- 66cbb55: Drag and drop, completed.

  **A card follows the cursor.** The node stays where it is, dimmed, and a copy
  travels — the convention every file manager uses, and for a reason: the
  original is where the node still is until you let go, and a drag you can
  abandon needs something to abandon it to. The copy is a clone of your own
  overlay element, so it looks exactly right whatever your card is, including
  your CSS.

  **The chart pans at the edges.** Without it a drop is only possible onto
  something already on screen, which on a chart big enough to need dragging is
  usually the wrong place. The speed ramps with depth into the zone rather than
  switching on at a line.

  **The keyboard can move a node too.** Focus a row in the screen-reader tree,
  press `m` to pick it up, move to another row, press `m` again to drop it in,
  or Escape to put it back. Announced through a live region, because a keyboard
  user gets no drop preview — the announcement is the feedback, not a courtesy
  on top of it. `into` only: the row list gives no way to point at a gap between
  two things, and reparenting is the part with no other keyboard route.

  **`nodeDrop` in Vue and React.** `@node-drop` and `onNodeDrop`, emitted
  synchronously so `preventDefault()` on the payload still works.

  Also: overlay elements now carry `data-klad-id`. Slots are pooled and
  reassigned as the camera moves, so this is the only way to find the element
  currently showing a given node — a drag needs it to clone the card, and a test
  needs it to assert a node rendered.

### Patch Changes

- The "there is more inside this" mark is no longer drawn on a `file` layout.
  A file list is a column of rows with a disclosure control on each one, so a
  stub hanging off the bottom of a row says the same thing the chevron beside
  its name already does — in a second place, and reading as a stray guide line
  rather than as a mark. The tiered layouts and the wheels keep theirs.

- cfddd4a: A drop now animates, and holds the place you dropped it.

  Two things a reparent got wrong. The chart rebuilt from a new dataset, which
  as far as the engine was concerned shared no index space with the old one — so
  every node snapped to its new position with no tween. And because a `tidy` or
  `radial` layout reflows around the change, the destination you had just aimed
  at slid somewhere else, leaving you to find your place again.

  `ChartEngine.animateNextLayout(sourceRemap)` says the next `setData` is a MOVE:
  the same nodes at different positions, with a mapping from the outgoing index
  space to the incoming one. The transition then reads across it and tweens.
  It is tied to `setData` rather than to "the next relayout" on purpose — the
  mapping describes one replacement, so arming it without one does nothing.

  The vanilla chart arms it on every drop and, alongside it, pins the drop
  TARGET's screen position across the rebuild. The target, not the moved node:
  anchoring what you dragged would pull the camera along with it, which is the
  one thing that is supposed to move.

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

## 1.1.0

### Minor Changes

- c44e9db: `data` is now the only option without a default.

  `nodeSize` defaults to `{ w: 180, h: 64 }` — a readable name-and-role card at
  1:1, exported as `DEFAULT_NODE_SIZE` for anyone sizing their own cards around
  it. `label` defaults to whichever of `name`, `label` or `title` a node
  actually carries, falling back to its `id`.

  ```ts
  createKlad(host, { data }) // a working chart
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
