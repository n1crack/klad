# @klad/react

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

- Updated dependencies [b217f4b]
- Updated dependencies [8f102d8]
- Updated dependencies [28b7239]
  - @klad/core@1.8.0

## 1.7.0

### Minor Changes

- ccb0c29: `edit` — every change to the shape, however it was made.

  ```ts
  chart.on('edit', (change) => queue.push(change))
  ```

  A drag reports itself through `nodeDrop` and an API call is something you made
  yourself. A viewer pressing `Alt+Up` or `Delete` restructures the tree with
  nobody else in the room — so with `keyboardEditing` on, a host could not know
  an edit had happened, and therefore could not save it.

  Carries the same `Change` that `changes()` collects, so persisting each edit as
  it happens and batching them until a save button take the same shape. Fires
  whether or not `history` is on: "keep no way back" and "tell me nothing" are
  different requests. `undo` and `redo` do not fire it — they are calls you make,
  and treating a withdrawal as a new edit would have anyone mirroring this apply
  it twice.

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

- f8ac009: `viewChange` — one event for the whole view.

  ```ts
  chart.on('viewChange', (view) => store.save(view)) // straight back into setView
  ```

  Camera, open branches, selection, highlight, isolation, filter and lifted caps,
  in one payload, exactly what `getView()` returns. Mirroring the chart into a
  store used to mean subscribing to several events and merging them back into the
  picture they came from.

  It fires when any of it changes and never for a redraw that changed nothing, so
  panning does not flood it.

  This is deliberately not a step toward controlled state. Whether a branch is
  open is a fact about the screen rather than about your data, and routing every
  toggle through your store would put a framework render inside a 16ms
  interaction — worse, `loadChildren` makes opening a node asynchronous and
  data-changing, so that round trip would grow a second leg. The chart keeps
  holding it and now says what it holds.

  **Two notes on size, one of which corrects the docs.**

  The `open` array names every open node, so a whole view fits in a URL on a small
  chart and does not on a large one. The documentation said "put one in a URL and
  you have a link to a place in a chart" without that caveat; it now says to take
  the small parts (`camera`, `isolated`, `filter`) for a link and use storage for
  a full restore. `setView` fills in whatever is left out.

  And that array is **frozen and shared between emissions**. It is rebuilt only
  when the open state actually changes, which is what keeps an event that fires
  per frame affordable at fifty thousand nodes — sorting it in place would corrupt
  that, so it cannot be. Copy it if you need to reorder.

- f31e5cd: Restructuring the tree from the keyboard.

  ```ts
  createKlad(el, { data, keyboardEditing: true })
  ```

  On the focused node:

  |                        |                                              |
  | ---------------------- | -------------------------------------------- |
  | `Alt` + `↑` / `↓`      | One slot among its siblings.                 |
  | `Alt` + `←`            | Out one level, to just after its old parent. |
  | `Alt` + `→`            | In one level, under the sibling above it.    |
  | `Delete` / `Backspace` | The node and everything under it.            |
  | `Shift` + `Enter`      | Asks for a new sibling.                      |

  Less was missing here than it looked: a node could already be moved from the
  keyboard with `dragAndDrop` on — `m` picks it up, arrows carry the focus, `m`
  drops it there. But that can only drop **into** a node, because dropping
  between two means pointing at a gap and a list of rows has no gap to point at.
  So the one thing an outline or a taxonomy is mostly made of — "this goes above
  that" — had no keyboard equivalent at all. These keys say "one up" instead,
  which needs no gap.

  Kept as a separate permission from `dragAndDrop` because they are not the same
  one: carrying a node somewhere is a rearrangement, and `Delete` is not.

  `canMove` applies to every move here, exactly as it does to a drag, and each is
  one edit, so one `undo` takes it back — including the whole subtree a `Delete`
  took.

  **Adding is a request, not an action.** A new node needs a row and the chart
  does not know what your rows look like, the same reason there is no rename. So
  `Shift+Enter` emits `addRequested` with the parent and index to use, and waits:

  ```ts
  chart.on('addRequested', ({ parentId, index }) => {
    const name = prompt('Name?')
    if (name !== null) chart.api.add({ id: crypto.randomUUID(), name }, parentId, index)
  })
  ```

  Ignore it and nothing happens.

  A key at the end of a level declines rather than doing a no-op move — the order
  would look the same either way, but a move that changes nothing is still a full
  relayout and an undo entry for nothing.

### Patch Changes

- Updated dependencies [ccb0c29]
- Updated dependencies [89a07b5]
- Updated dependencies [f8ac009]
- Updated dependencies [f31e5cd]
  - @klad/core@1.7.0

## 1.6.0

### Minor Changes

- 77628a9: Three ways the tree's shape can change, and a place to put your own rule about
  them.

  ```ts
  chart.api.move('lead-42', 'engineering', 0)
  chart.api.add({ id: 'new-hire', name: 'Sam' }, 'engineering')
  chart.api.remove('closed-team')
  chart.api.getData() // your rows, with the edits applied
  ```

  Each returns whether it happened. Dragging was the only edit there was, and it
  now goes through the same door, so what is true of one is true of both.

  **There is no rename, and there cannot be.** A node's text comes from your
  `label` reading your own row, so the chart does not know which field is the
  name. It owns the shape; you own the content. Change the row and `refresh()`.

  ### Your rule, asked while the pointer is still down

  ```ts
  canMove: ({ items, parentId }) => parentId === null || items.every((item) => item.kind !== 'contractor')
  ```

  Refusing in `nodeDrop` answered too late: the drop indicator had already said
  "yes, here", and the node snapped back after the viewer let go. `canMove` is
  asked during the drag, so the indicator turns red under the pointer instead —
  and again at the drop, and by `move()`, because a rule the pointer path honours
  and the API does not is a hint rather than a rule.

  Consulted once per target node crossed rather than once per pointer move.

  ### The rest of what gets refused

  A move into a node's own subtree, since the result would not be a tree — two
  comparisons on the nested-set bounds rather than an ancestor walk. An id the
  chart does not have. An `add` whose id is already taken. And anything touching
  the node a capped level invents: it is a real node in the tree, so each of
  these says no on purpose.

  `remove` takes the subtree with it. Leaving the children behind promotes each
  of them to a root, which is a bigger change than the one asked for.

  ### One call, not a loop

  An edit lays the whole tree out again. On 20,000 nodes that is about 350ms —
  invisible behind the transition when a person drags one node, very visible in a
  loop. Every method takes an array for this reason: 100 separate `move` calls
  measure ~1300ms, the same 100 ids in one call ~355ms.

- a4de406: Undo, redo, and the changes as something you can send.

  ```ts
  chart.api.undo()
  chart.api.changes() // what to PATCH
  chart.api.markSaved() // sent
  ```

  A drag that restructures somebody's organisation with no way back is a
  frightening thing to hand a user. Every edit is recorded — drags included,
  since a drag goes through the same door the API does.

  **The log is the product; undo is the convenience.** An app with its own undo
  stack does not want a second one underneath it, because two stacks make Ctrl+Z
  a coin toss. Set `history: false` and read `changes()` instead — it still
  works with the history off.

  `changes()` describes what to **do**, with ids rather than indices, so a change
  still means the same thing after your own store has moved on. What it takes to
  reverse an edit the chart keeps to itself.

  Reversing a move puts each node back with **its own** former parent and slot,
  which is not always the set's — a batch move can have come from several
  parents. Reversing a remove puts the whole subtree back. Positions are
  remembered as the sibling a node sat _after_, never as an index: an index is
  only right until the next edit moves something in front of it.

  `history` defaults to 100 edits. It costs memory rather than speed — nothing on
  the drawing path reads it, and a move on a 20,000-node chart measures 328ms
  without history and 337ms with. A record names ids, so it follows how much you
  edit rather than how big the chart is; `remove` is the exception, holding the
  subtree it took out until that record falls off the end.

  Fresh data clears it: `update` and `reconcile` are both somebody else
  describing the tree, and an edit made before that description refers to a shape
  nobody is claiming any more.

  Also: `add(rows)` with the parent left off now keeps each row's own `parentId`
  instead of making them all roots. `null` still means roots. That is what
  putting a removed subtree back needs, and it is the rule `loadChildren` already
  follows for the rows it returns.

- dee28ea: `reconcile(data)` — take a fresh copy of the tree without losing where the
  viewer is.

  ```ts
  socket.on('tree', (rows) => chart.api.reconcile(rows))
  ```

  `update(data)` means "this is a different tree": it resets your expand state,
  forgets what `loadChildren` fetched, and drops the caps you had lifted. That is
  right when the chart is genuinely being pointed at something else, and wrong
  several times a minute when a poll or a socket is feeding it the same tree.
  Until now it was the only door, so a chart driven from a live source folded
  itself back up under the viewer on every message.

  `reconcile` keeps all of that, plus the camera, the selection and the filter —
  and the difference animates: rows that arrived fade in, rows that left fade
  out, everything else tweens to where it now sits.

  A row that is new to the chart starts the way it would have started had it been
  in `data` from the beginning: `collapsedByDefault` decides, and it starts closed
  if `mayHaveChildren` says it is waiting on a fetch.

  **Lazily-fetched branches survive**, because `data` never described them —
  dropping them would collapse every branch the viewer had opened, on every poll,
  on exactly the trees that need reconciling most. Two exceptions, both forced:
  children whose parent is no longer in `data` go with it, and a row `data` now
  carries itself replaces the fetched copy, since the newer statement wins and a
  duplicate id is the one thing the chart cannot make sense of.

- 956b7fd: The line between a parent and a child is a setting now.

  ```ts
  createKlad(el, { data, edgeStyle: 'spoke' }) // tidy, but straight lines
  createKlad(el, { data, edgeStyle: 'none' }) // no connectors at all
  ```

  `'tiered' | 'folder' | 'spoke' | 'none'`. Each layout still picks the one that
  reads correctly on it and that stays the default, because a folder guide line
  down a tiered chart is a mistake rather than a taste. This is for the chart
  that wants a different answer anyway: a wide tidy tree that reads better with
  straight lines, or one whose own cards already carry the structure and where
  the lines are noise.

  Changeable live through `setLayoutOptions`, and the SVG export follows it, so
  an export of a chart drawn with straight lines does not come back with elbows.

  **It does not cost you the "there is more inside" mark.** The short stub and
  dot below a collapsed node used to disappear for `'spoke'` and `'none'`, which
  was correct while those could only mean a wheel — a wheel draws its own arc or
  halo instead. Chosen freely they can now land on a tiered chart, where the
  branch still continues downward whether or not a line is drawn to it, and at
  the zoom where the cards and their toggles are gone that mark is the only thing
  saying so. It stays. `'folder'` still drops it on purpose: a file row has a
  chevron beside its name and a stub underneath would say it twice.

  Changing the style relayouts rather than repainting, because `'none'` skips
  building the edge index and its whole quadtree — coming back from it has to
  build one.

  The playground's View panel has a **Connector** control on every layout.

- 441e2d9: Every per-node option now gets a second argument saying where the node sits.

  `nodeSize`, `label`, `collapsedByDefault`, `mayHaveChildren` and `pinChildren`
  were each handed the node's data and nothing else, so none of them could answer
  a question about depth or about a node's place among its siblings. They now
  receive a `NodePlace`:

  ```ts
  createKlad(el, {
    data,
    collapsedByDefault: (item, at) => at.depth > 2,
  })
  ```

  `{ depth, index, siblings, parent }` — distance from a root, the slot among its
  own siblings in data order, how many siblings there are counting itself, and
  the parent's data.

  A flat `{ id, parentId }` array does not say what depth anything is at, so the
  alternative was walking parent links yourself, once per node per data change.
  The playground had to do exactly that, and the workaround it needed is deleted
  by this: a cached depth map keyed by the dataset, plus a per-example override
  for the one example the map could not answer — the file explorer that fetches
  its own rows, because a row `loadChildren` returned is in no array you hold.

  Every field is about the node's place in the DATA, not on screen. Depth does
  not change when a branch is collapsed or a filter hides its siblings, and the
  export path reports a node's real sibling slot rather than its slot among
  whatever survived pruning.

  Additive — an option written against the old single-argument signature keeps
  working unchanged.

  Measured rather than assumed: a 20,000-node refresh with both `nodeSize` and
  `label` as functions goes from 318.9ms to 328.6ms, so building forty thousand
  of these costs about 3% of a relayout. The sibling index is swept once per tree
  and cached against the tree object, not read off the CSR per node.

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

- Updated dependencies [77628a9]
- Updated dependencies [a4de406]
- Updated dependencies [dee28ea]
- Updated dependencies [956b7fd]
- Updated dependencies [57142dd]
- Updated dependencies [441e2d9]
  - @klad/core@1.6.0

## 1.5.1

### Patch Changes

- Updated dependencies [65dabeb]
  - @klad/core@1.5.1

## 1.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [41ddf0d]
- Updated dependencies [f35d7e0]
- Updated dependencies [ba57e19]
- Updated dependencies [23ed03b]
- Updated dependencies [433c79c]
- Updated dependencies [a854c03]
- Updated dependencies [fec4c77]
- Updated dependencies [36e1a49]
- Updated dependencies [1c9d1da]
- Updated dependencies [560c51e]
- Updated dependencies [075963e]
- Updated dependencies [7197a12]
- Updated dependencies [89233a3]
  - @klad/core@1.5.0

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

### Patch Changes

- Updated dependencies [4585c84]
  - @klad/core@1.4.0

## 1.3.1

### Patch Changes

- Updated dependencies [94a2119]
  - @klad/core@1.3.1

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

- Updated dependencies [4aa5140]
- Updated dependencies [6f61f1d]
- Updated dependencies [66cbb55]
- Updated dependencies [cfddd4a]
  - @klad/core@1.3.0

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
  - @klad/core@1.2.0

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
