# @klad/core

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
  const found = chart.api.filter("schema"); // the ids that matched
  chart.api.filter(null); // back to the whole tree
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

- 36e1a49: `stats(id)` now carries nested-set bounds: `lft` and `rgt`.

  A node's pair brackets every pair below it, which turns "is this node inside
  that branch" from a walk up the parent chain of unbounded length into two
  comparisons:

  ```ts
  const branch = chart.api.stats("engineering")!;
  const node = chart.api.stats("lead-42")!;
  const inside = node.lft > branch.lft && node.rgt < branch.rgt;
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

- 1c9d1da: Picking, not "show them all".

  `NodeContext.overflow` now carries `items` alongside `ids` — the hidden nodes'
  own data objects, in the same order — so a picker can show names without going
  back to the host's array to look each one up.

  And `refresh()` re-reads `maxChildren` and `pinChildren`. That is how a working
  set reaches the chart: `pinChildren` closes over a set the host mutates, and
  when that set changes neither the options object nor the data has, so there was
  nothing for the chart to notice. Those are per-node answers from the host
  exactly as `nodeSize` is, and re-reading those means re-reading these. With a
  cap configured `refresh()` now takes the heavier path and animates, because a
  cap is structure rather than a measurement.

  Together these are what a big level actually needs. `showMore` is right for a
  level of twelve with a cap of eight; it is wrong for a level of four hundred,
  where unreadable is the problem the cap is solving and a button back to
  unreadable is that problem with an invitation attached. The guide now says so
  and shows the picker instead.

- 560c51e: `refresh({ keep })` — hold one node's screen position across the relayout.

  Ticking somebody in a picker hung off an aggregate node swaps who is on that
  level, and without a pin the level slid out from under the panel the viewer was
  still reading. `keep` is the same pin a drop puts on its target. The aggregate
  node is the right anchor here, unlike a `showMore`: the cap stays on, so the
  node stays too.

  `animateNextLayout` also takes the direction now — `opening`, defaulting to
  `true`. The transition is two phases and which visual job each does flips with
  it: arriving, room is made first and the new nodes settle into it; leaving,
  they go first and the gap closes behind them. A move previously had no opinion
  and inherited whatever the last expand or collapse left behind, so the same
  action could animate one way after opening a branch and the other after closing
  one. A cap change derives it from what actually happened to the tree.

- 89233a3: Very wide levels: `maxChildren` and `pinChildren`.

  ```ts
  createKlad(host, {
    data,
    maxChildren: 8,
    pinChildren: (item) => watching.has(String(item.id)),
  });
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

### Patch Changes

- 41ddf0d: Four gaps found reviewing 1.5, all of them the node a capped level invents
  leaking somewhere it does not belong.

  - **It could be dragged, and dropped into.** Both are now refused, from the
    pointer and from the keyboard. It stands for other nodes rather than being
    one, so moving it has no meaning — and `nodeDrop` must never report an id the
    host has never seen. That included the case where a box or lasso selection
    swept it up and a drag carried the whole selection.
  - **`search` returned it.** Its `item` is a stub with nothing on it but an id,
    so a caller looping results to read a field would find nothing there.
  - **`stats` counted it.** A card reading `directChildren` to say "20 reports"
    said 21. The counts now leave the invented nodes out; `lft`/`rgt`, being
    positions rather than counts, still include them, which leaves containment
    correct and scopes the `rgt - lft === 2 * descendants + 1` identity to a
    chart with nothing capped.
  - **A view did not carry the caps or the filter.** `getView`/`setView` now
    round-trip `filter`, `uncapped` and `revealed` alongside `isolated` — a link
    that restored everything except what the viewer had filtered and opened up
    would come back a different chart. A filter set with a predicate is the one
    thing a view cannot carry, since a function does not go in a URL; that is
    stated rather than silently rounded to "no filter".

- f35d7e0: Four bugs found hunting through 1.5, three of them where a capped level meets
  something else.

  **Two drops in a row corrupted the data.** A reparent rebuilds the host's array
  from the chart's current rows, and those included the node a cap invents. So
  the first drop wrote an aggregate into `data`; the second renormalised that
  array, planned a second aggregate for the same parent, and landed on a
  duplicate id. The rows that came from outside the chart are now a separate
  thing from the rows the chart adds to them, and only the first kind is ever
  written back.

  **A drop after that also lost the cap.** The same reparent normalised its own
  array directly instead of replanning, so the aggregate vanished until something
  else forced a full rebuild.

  **`nodeDrop` reported the wrong index.** It counted among the DRAWN siblings,
  and a capped level draws eight of four hundred. With a pin in the mix the two
  numbers diverge by any amount: dropping after a pinned twentieth child reported 5. The index is now translated back into the parent's real child list, which
  fixes the same divergence under a filter.

  **Lifted caps survived `update(data)`.** They name nodes in the dataset being
  replaced, so they lifted caps on ids that no longer existed — or on ones that
  happened to exist again and that nobody had opened. Cleared now, like the
  loaded children beside them.

  Also: a `filter` drops a pending `focus`. A deferred focus waits for the
  relayout that reveals its target, which for a node the filter excludes never
  comes — and clearing the filter later would resolve the wait and jump the
  camera somewhere nobody had asked to go any more. And `reveal` returns early
  without a cap, rather than paying a full relayout to reveal nothing.

- ba57e19: Three more from the bug hunt, each one the chart's own bookkeeping showing
  through somewhere it should not.

  **The export lost the "more inside" mark on an unfetched branch.** That rule
  lives in two places by necessity — in worker mode the live engine is
  unreachable from the main thread, so the export recomputes it — and children on
  demand taught the engine about unloaded nodes without teaching the mirror. The
  mark was on the canvas and missing from the picture of the canvas.

  **A cap's aggregate node could be sent to `loadChildren`.** It is childless by
  construction, so any `mayHaveChildren` loose enough to say yes to a stub with
  none of the host's fields would put a "more inside" mark on the chart's own
  invention and then fetch it.

  **A filter could match it.** Its fallback label is `+15`, so `filter('1')`
  matched. `search` already refused it; `filter` now does too, for the same
  reason: both answer questions about the host's data, not about the chart's
  bookkeeping.

  Also covered: caps and filters through the worker, which every other test for
  them ran in-process; a cap of zero and a cap bigger than the level; and the
  fact that `maxChildren` caps children and therefore not roots, which is now
  stated in the guide rather than left to be found.

- 23ed03b: Lifting a cap, and loading a branch, now hold their place.

  **The camera.** Clicking "+392 more" makes that level three hundred and
  ninety-two nodes wider, and a `tidy` parent is centred over its children — so
  the node you clicked from slid hundreds of pixels away while you were looking
  at it. The parent is now pinned across the rebuild, the same way a drop pins
  its target. Not the aggregate node: lifting the cap is what removes it.

  **The minimap.** Neither a lifted cap nor an arriving branch asked it to refit,
  though both change what the map is a map OF at least as much as isolating does
  — which has asked for one since 1.1. Without it the whole chart ends up drawn
  in the corner the capped level used to occupy.

  Also documented: `maxChildren` and `pinChildren` must be defined outside the
  render in Vue and React, or memoised. Both adapters call `update()` when the
  options object changes identity, and that now resets every cap the viewer had
  lifted as well as the open branches — so an inline arrow undoes their work on
  every render.

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

- 075963e: The camera pin now rides the transition instead of jumping ahead of it.

  A pin holds one node's screen position across a relayout — the target of a
  drop, the parent of a lifted cap, the node a lazy load hung off. It solved once
  against where that node would END UP, on the first frame, while every node was
  still drawn where it had been. So the whole chart jumped the full distance and
  then drifted back into place, which reads as a snap and hides the animation
  completely.

  It is now re-solved every frame against the node's interpolated position, for
  as long as the transition runs. The pinned node stays genuinely still and
  everything reflows around it, which is what a pin was supposed to mean.

  Visible on any pin where the node moves far. Lifting a cap on a level of twenty
  moved the chart 532 pixels on frame one; drops mostly got away with it because
  a drop target rarely moves much.

  Also measured and written down: on a 20,000-node forest a full relayout is
  328ms uncapped and 315ms with a cap and a pin predicate, and filtering the same
  tree to 11,000 matches costs about what a plain `refresh()` does.

- 7197a12: A pin that swaps says which node it brought in.

  With slots to spare, pinning somebody does not widen a capped level — it takes
  the slot off whoever was last. That is a cross-fade in the same place, and what
  it reads as is "the whole thing re-rendered" rather than one node arriving. The
  chart now flashes its confirmation ring on the arrival: the existing "the thing
  you asked for is HERE" marker, and one node arriving is exactly the single-node
  action it was built for.

  Only when exactly one node comes out from behind the cap. A `showMore` brings
  back fifteen at once and rings none of them, because fifteen rings is a strobe.

  The two behaviours this makes legible were already correct and are now covered:
  below the cap a pin SWAPS — three stay three, and the one that lost its slot is
  the last of them — and past the cap the pins win and the level grows instead.

- Updated dependencies [433c79c]
- Updated dependencies [a854c03]
- Updated dependencies [fec4c77]
- Updated dependencies [36e1a49]
- Updated dependencies [89233a3]
  - @klad/engine@1.5.0

## 1.4.0

### Minor Changes

- 4585c84: Children on demand — a chart no longer needs its whole tree up front.

  ```ts
  createKlad(host, {
    data: roots,
    mayHaveChildren: (item) => Number(item.childCount) > 0,
    loadChildren: (item) =>
      fetch(`/api/children/${item.id}`).then((r) => r.json()),
  });
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

### Patch Changes

- Updated dependencies [4585c84]
  - @klad/engine@1.4.0

## 1.3.1

### Patch Changes

- 94a2119: A host positioned by a stylesheet is left alone.

  `position: absolute; inset: 0` is the ordinary way to make an element fill its
  parent. The chart read `host.style.position` — the INLINE attribute, empty in
  that case — concluded the host was unpositioned, and wrote `position: relative`
  over the top. Inline beats a stylesheet, so the rule was not overridden, it was
  defeated: the host collapsed to its content height, the canvas sized itself to
  that, and the minimap anchored to the bottom of a chart that ended halfway up
  the page.

  It now reads the COMPUTED position and only steps in when there is none, which
  is all it ever needed to do — the overlay, minimap and drag ghost need a
  containing block, and any positioning makes one.
  - @klad/engine@1.3.1

## 1.3.0

### Minor Changes

- 4aa5140: Three things a drag could not do.

  **Closed branches spring open.** Rest the pointer on a collapsed node for
  about half a second and it opens, so you can carry on into it. Before this a
  closed branch was a wall — its children are off screen, so there was nothing
  to aim at, and no way to open one while the gesture had both your hands. What
  sprang open closes again when you let go, except the branch the drop actually
  landed in: wandering across six folders on the way to the seventh should not
  leave all seven standing open.

  **Escape puts the node back down.** No `nodeDrop`, nothing moved. The same
  path now handles `pointercancel`, which used to route to the same place as
  `pointerup` — so a gesture the browser reclaimed, a touch it decided was a
  page scroll, restructured the tree on its way out.

  **The cursor answers "will this be taken?"** `grabbing` while dragging,
  `no-drop` over a target that would refuse. Set by the chart on its own host
  and canvas, with cards taken out of the pointer's way for the length of the
  gesture — so it works without the host writing any CSS. `.klad-dragging` and
  `.klad-drag-refused` are still on the host for anyone who wants a different
  look.

  Also: `NodeDropEvent` is now exported from every package. Typing a `nodeDrop`
  handler meant digging the shape out of `KladEvents['nodeDrop']`, which is not
  a thing anyone should have to do to write the one handler this feature is
  about.

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

- Updated dependencies [6f61f1d]
- Updated dependencies [66cbb55]
- Updated dependencies [cfddd4a]
  - @klad/engine@1.3.0

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
