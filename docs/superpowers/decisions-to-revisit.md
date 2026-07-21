# Decisions taken unilaterally, to review once the UI is on screen

Standing instruction from the project owner: keep moving without asking; where a
choice is genuinely uncertain, pick the recommended option, record it here, and
review the whole list together after there is a working UI.

Each entry states what was chosen, why, and what would make it wrong.

---

## From the render/adapters plan

### 1. The DOM overlay only activates when `renderNode` is supplied
**Chosen:** if a consumer passes no `renderNode`, the chart is canvas-only at every zoom.
**Why:** a framework-less user who wants a plain chart should not pay for DOM at all.
**Wrong if:** we later want a built-in default card, in which case there should be a
fallback renderer rather than nothing.

### 2. Zoom defaults: `minK: 0.05`, `maxK: 4`; spacing `x: 16`, `y: 48`
**Chosen:** picked to make a few-thousand-node chart fit a laptop viewport at the low end.
**Why:** no data yet on what feels right.
**Wrong if:** a 50k chart cannot fit on screen at `minK: 0.05` — check against the
playground's 50k fixture, and lower the floor if `fit()` clamps.

### 3. LOD thresholds stay at the spec's `0.25` / `0.6`
**Chosen:** as written in the design.
**Why:** they were reasoned about, not measured.
**Wrong if:** the label tier looks illegible at 0.25, or the overlay kicks in so late that
cards feel like they pop in. Both are eye judgements that need the UI.

### 4. Wheel zoom curve is `1.0015 ^ -deltaY`
**Chosen:** a common exponential mapping.
**Why:** it is smooth and trackpad-friendly, but the constant is a guess.
**Wrong if:** zooming feels too fast on a mouse wheel or too slow on a trackpad — those
two devices report wildly different `deltaY` magnitudes and may need separate handling.

### 5. Tap versus drag threshold is 4 px of accumulated travel
**Chosen:** small enough not to swallow deliberate drags, large enough to absorb trackpad jitter.
**Wrong if:** clicks get lost on touch, where travel is larger.

### 6. Connector routing is an orthogonal three-segment elbow
**Chosen:** parent bottom → midpoint → child top.
**Why:** it matches the v0.2.5 look and is cheap to batch into one path.
**Wrong if:** we want curves instead of elbows.
The `lr`/`rl` case is handled: `Frame.horizontal` switches the split to the x axis, since
splitting on Y there would route connectors straight through node boxes.

### 7. Highlight translation is O(highlighted × visible)
**Chosen:** a linear scan per highlighted id inside the engine.
**Why:** search results are small, and a reverse map would have to be rebuilt per relayout.
**Wrong if:** anything ever highlights thousands of nodes at once.

### 8. `search()` matches against the label only
**Chosen:** substring, case-insensitive, over whatever `label()` returns.
**Why:** it is the only text the chart knows about.
**Wrong if:** users expect to search a title or department that is not in the label. A
predicate overload already exists as the escape hatch, so this may be enough.

### 9. Events shipped: `nodeClick`, `toggle`, `viewportChange`, `warning`, `ready`
**Not shipped yet:** `nodeDblClick`, `nodeHover` (both in the spec's API list).
**Why:** hover needs a hit-test per pointer move and a decision about throttling; double
click needs a click-delay policy that interacts with tap detection.
**Revisit:** together, once the interaction feel is testable.

### 10. Camera animation is instantaneous
**Chosen:** `focus()` and `fit()` jump rather than tween, even though `interpolate` and
`easeInOutCubic` exist in core.
**Why:** the tween needs a frame loop and a cancellation policy that the input handler
must respect; wiring it before the UI exists would be guesswork.
**Revisit:** immediately after the UI — jumping will almost certainly feel wrong.

### 11. Worker font loading is deferred
**Chosen:** the default theme uses system fonts, which need no loading.
**Wrong if:** a consumer sets a web font in `theme.labelFont` — worker-side text will
silently fall back to a default face until `FontFace` + `self.fonts.add` is wired up.

### 12. `wireTreeToTree` synthesises ids as `String(index)`
**Chosen:** the worker addresses nodes by index and never needs a real id.
**Why:** keeps `indexToId`/`idToIndex` off the wire entirely.
**Wrong if:** anything worker-side ever needs to report a user-facing id — it would get
`"7"` instead of `"alice"`. Watch for this when worker-side errors start mentioning nodes.

### 17. `truncate` returns the ellipsis alone when nothing else fits
**Chosen:** when the budget covers the ellipsis but not a single character, return `'…'`
rather than an empty string.
**Why:** it tells the reader something was cut. An empty cell reads as missing data.
**Wrong if:** a bare ellipsis at tiny node widths looks like noise — at that zoom the LOD
tier probably should not be drawing text at all, so this may be moot.

### 18. Text width cache keeps FIFO eviction, not LRU
**Chosen:** FIFO, now that binary-search probes no longer enter the shared cache.
**Why:** the probe fix removes the pressure that made FIFO hurt; LRU is a bigger change.
**Wrong if:** profiling on a real chart shows the width cache still thrashing.

### 19. `RenderContext2D.fillStyle` / `strokeStyle` are typed `unknown`
**Chosen:** widened from `string` so a real `CanvasRenderingContext2D` satisfies the
structural interface — the DOM type is `string | CanvasGradient | CanvasPattern`.
**Why:** these are only ever written, never read, so nothing is lost.
**Wrong if:** the renderer ever needs to read a style back, at which point it needs a
proper union rather than `unknown`.

### 20. Browser tests get their own tsconfig with `lib.dom`
**Chosen:** `packages/core/tsconfig.browser-test.json`, run as a second `tsc` pass.
**Why:** the runtime sources must stay DOM-free or the Web Worker guard is meaningless,
but untyped tests rot. Source files pulled in transitively do see DOM types under this
config, yet they are still checked without them by the main config, so the guard holds.
**Wrong if:** the two programs drift far enough that something typechecks in one and not
the other in a confusing way.

### 21. Overlay idle slots detach from the DOM instead of hiding
**Chosen:** an overlay element that is no longer needed is `remove()`d and re-appended
later, rather than kept in place with `display: none`.
**Why:** honestly, because a test counts elements with `querySelectorAll('.orgchart-overlay-node')`
and expected zero at low zoom. The pooled element objects still survive, so identity
across frames holds — but a fluctuating visible set now pays append/remove churn that
`display: none` avoided.
**Wrong if:** panning at high zoom stutters. The better fix would be to count *attached and
visible* elements in the test rather than reshape the implementation around it.
**This is a case of a test driving a design change — worth a second look.**

### 22. Warnings are emitted on a microtask, not synchronously
**Chosen:** `createOrgChart` defers `warning` events so a caller can attach
`chart.on('warning', ...)` after construction and still receive them.
**Why:** emitting during construction meant nobody could ever hear them.
**Wrong if:** a consumer expects warnings to be readable synchronously after the
constructor returns. An alternative is to expose them on the returned state as well.

### 23. The accessibility mirror is rebuilt wholesale on every update
**Chosen:** clear and re-append every row when the tree or open state changes.
**Why:** correctness first; `content-visibility: auto` keeps the layout cost down.
**Wrong if:** the measured rebuild time at 10k+ nodes is material — this is a full DOM
teardown on every expand or collapse, which is precisely the cost the canvas renderer
exists to avoid. A pooled or diffed mirror is the fix if so.

---

## Carried over from the core foundation work

### 13. `.gitignore` has duplicate entries in bare and slash form
Cosmetic, inherited from the scaffold step.

### 14. `tree.ts` repeats its bounds check three times
Could be a small `inRange(tree, i)` helper. Purely cosmetic.

### 15. Out-of-range indices return `false` / empty rather than throwing
`subtreeOf` and `wouldCreateCycle` accept any index and answer quietly.
**Wrong if:** the drag-and-drop reparenting work in the features plan starts computing
indices and needs a loud signal when it computes a wrong one.

### 16. Task 3's final documentation pass was never re-reviewed
Five Minor findings, all comment accuracy and test strength, fixed but not verified by a
second pass. Nothing behavioural.
