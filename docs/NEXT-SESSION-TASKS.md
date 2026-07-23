# Klad — remaining work (resume from `dev`)

Written before a context clear. This is the authoritative to-do for the next session.
Work continues on the `dev` branch. The full design is
`docs/superpowers/specs/2026-07-21-orgchart-rework-design.md`; the plans are in
`docs/superpowers/plans/`; the running list of unilateral choices is
`docs/superpowers/decisions-to-revisit.md`.

## Where things stand

Five packages, all green (423 tests): `@klad/core`, `klad`
(vanilla), `@klad/vue`, `@klad/react`, plus a private playground.
Everything runs from source through the pnpm workspace — no build step yet. `pnpm dev`
serves the playground; `pnpm test` / `pnpm typecheck` / `pnpm lint` from the root.

Implemented and working: the whole worker-backed Canvas2D pipeline, tidy layout,
orientations + RTL, quadtree cull + hit-test, in-house viewport, LOD tiers, text
measurement, theme, worker + main-thread fallback, SVG export, the vanilla DOM layer
(pointer, kinetic pan, pooled overlay, accessibility tree with full keyboard nav
including arrow-left/right, minimap silhouette, export, `setMinimap`, `setTheme`), the
Vue and React adapters, the two-phase expand/collapse transition with camera anchor and
overlay sync, the one-shot ring, and a redesigned sidebar playground with live controls.

## Deferred out of v1.0

### Drag-and-drop reparenting → next major
Decided 2026-07-22: **not** shipping in v1.0. The spec (§11.1) promises it, but the
interaction is a project in itself and 1.0 is otherwise feature-complete, so it moves
to the next major rather than holding the release.

For whenever it is picked up: core already has the cycle guard —
`wouldCreateCycle(tree, index, newParent)` — and `reparent` semantics are designed.
What's missing is the whole interaction in the vanilla layer: pointer-drag a node,
draw a ghost, highlight the drop target via the main-thread quadtree, reject a drop
that would form a cycle (event reports `prevented`), and on a valid drop mutate the
tree with a dirty-subtree relayout and a tween. Touch: `packages/vanilla` (drag
handling on top of the existing input module), `packages/core` engine (a `reparent`
mutation + incremental relayout), events (`reparent`, and a `warning`/`prevented`
path). Add it to all three adapters' event surfaces. Playground: a draggable example.

## The only thing left for v1.0

### 1. First publish to npm
The pipeline itself is built (see below); what remains needs the npm account,
so it happens from the machine that has it:

- Add an **`NPM_TOKEN`** repository secret (an npm automation token with
  publish rights on the four `klad*` packages). Nothing else is missing — the
  release workflow is already written against it.
- Confirm the `@klad` scope exists and the four package names are free
  (`klad`, `@klad/core`, `@klad/vue`, `@klad/react` all read as
  unpublished on the registry as of the rename).
- Decide the first published version. Everything currently sits at
  `1.0.0-alpha.0`; `pnpm changeset` then `pnpm version-packages` is what moves
  it.
- Optional: one last release of the OLD `vue3-org-chart` npm package whose
  README points at `klad-*`.

### What is already in place

- **`tsdown` build per publishable package** → `dist`, ESM only, with
  declarations. Core emits three entries (`index`, `worker/host`,
  `worker/chart.worker`) named so the built layout mirrors the source one —
  the worker has to land beside `host.js`, which fetches it by relative URL.
- **Vue SFC declarations** via `vue-tsc`, against `tsconfig.build.json`, which
  exists for one reason: every package's `exports` points at its own source
  during development, so declaration emit produced imports referencing a
  sibling's SOURCE path, and every cross-package type silently became
  `undefined` in the shipped `.d.ts` — `NodeData`, and with it the payload of
  every event a consumer handles. Pointing at the siblings' built declarations
  fixes it; turbo's `^build` guarantees they exist. `@klad/core`
  is a direct dependency of the Vue package for the same reason: its published
  types name it.
- **Licence files copied into each package at build time**
  (`scripts/copy-license.mjs`). npm packs only what is inside a package
  directory and silently skips a listed path that is not there, so without
  this the tarballs would ship with no licence at all. Verified with
  `npm pack --dry-run`: all four carry `LICENSE` and `LICENSE-COMMERCIAL.md`.
- **`changesets`**, with the four published packages `fixed` to one version —
  they are one library split across an engine and three bindings, and a
  consumer should not have to work out which version combinations were ever
  tested together. The playground is ignored.
- **`build` wired into turbo** and into `pnpm build`.
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, test, build on every
  push to `main`/`dev` and every PR. Installs Chromium, since the suites run
  in a real browser.
- **Release** (`.github/workflows/release.yml`): on `main`, the changesets
  action either opens a "Version Packages" PR (when changesets are pending) or
  publishes what is not yet on npm (when they are not). Merging that PR is the
  act that releases, and it is a reviewable diff rather than a button.
  Publishes with npm provenance via OIDC.

## Queued polish (from decisions-to-revisit.md — none blocking)

- **`setTheme` for export:** SVG/PNG export takes its own independent `theme` option, so
  an exported file does not reflect a theme changed at runtime (e.g. edge radius, node
  fill). Make export default to the chart's current theme, override only when asked.
- **20k fit contrast:** at the Large example's zoomed-out fit, sub-pixel chain nodes
  antialias toward the background and are hard to read. A contrast/card-palette question,
  not a bug.
- **Ghost-overlap cosmetic:** a transient frame where a pooled overlay slot visually
  overlaps a different node than the one just toggled (pre-existing overlay pooling);
  chart settles correctly. Investigate if it bothers anyone.
- **Momentum feel:** kinetic-pan constants (tau 180ms, cap 2px/ms) are reasoned, lightly
  tuned. Re-judge on real input if it ever feels off.
- **LOD thresholds (0.25 / 0.6), wheel-zoom constant:** eye-tuned defaults, revisit if
  they feel wrong at scale.
- **`tree.ts` bounds-check duplicated 3x** → small `inRange` helper. Cosmetic.
- **`.gitignore` duplicate entries** (bare + slash form). Cosmetic.

## Landed on 2026-07-22

### 1.0 features (owner-verified in the playground)

- **Per-node counts** — `computeSubtreeStats` derives direct children, total
  descendants and subtree height in one O(count) pass per tree, so a card reads
  them as array lookups. On `api.stats(id)` and in every `renderNode` context;
  both adapters forward it unchanged.
- **Go to a node** — `focus` now waits for the layout its own `expandTo`
  produced, so the case it exists for ("everything closed, go to X") works at
  all; it stayed synchronous when nothing needed expanding. `focus(id, { ring:
  true })` flashes on ARRIVAL. `api.pathTo(id)` gives the root-to-node chain.
- **`api.refresh()`** — re-reads every node's `nodeSize`/`label` and relayouts,
  keeping expand/collapse, camera and highlight. `nodeSize` is declared, never
  measured, so a card that changes its own height had no way to say so and
  `update()` would have reset the tree.
- **Highlighted path edges** — an edge paints in `edgeHighlightStroke` when
  both endpoints are lit, which for a root-to-node chain is exactly the route.
  Second stroke pass, skipped entirely when nothing is highlighted.
- **Playground** — five new examples: subtree counts, a card with a dropdown, a
  sliding accordion that resizes its node, a custom-button toolbar, and an
  external combo box that goes to any node from a fully collapsed chart. Plus
  an "Accent" control driving ring/highlight/route colour together and a line-
  width slider.

### Six defects, each with a regression test that fails without its fix

- **Toggle camera anchor applied after the render it belonged to** — every frame was
  painted with the previous frame's camera against this frame's positions, so the
  pinned node slid ~12px and swung back. Now advanced before `render()`; drift is
  exactly zero.
- **The worker read its own clock** — a dedicated Worker's `performance.now()` counts
  from when the WORKER was created, not the document, so a transition started on one
  clock and advanced with the other finished instantly: the canvas snapped to the
  settled layout while the camera eased on alone. Every message now carries the main
  thread's clock; the worker never reads one.
- **The anchor guessed the transition's origin** — in worker mode the `open` message
  relayouts when dequeued (click time), not on the next frame, leaving the anchor a
  frame behind. The engine reports `transitionStartedAt` and the anchor measures from
  it.
- **Overlay cards ignored the reveal alpha** — an expand holds revealed children at
  alpha 0 through phase 1, on a zero-size box at the parent's edge, so their cards
  showed as bubbles hanging off the parent for ~190ms. `lastDrawnAlpha` is plumbed
  through to the overlay's `opacity`.
- **The minimap refit itself on every relayout** — collapsing the root made that one
  node fill the widget. The frame is held and only refitted when a layout no longer
  fits; the root is pinned to its widget pixel (and re-offset per frame against its
  interpolated position, so the rectangle doesn't slide during the transition).
- **A bare tap dropped the toggle anchor** — input cancels animations on `pointerdown`
  before it knows a pan is coming, but the layout keeps animating regardless, so
  tapping during a collapse left the toggled node somewhere else entirely. A touch
  that changes no camera no longer drops it; real gestures still do.

## Ground rules that carried through this project

- Commit author is always `Yusuf Özdemir <yusuf@ozdemir.be>`; **no trailers of any kind.**
- `packages/core` stays DOM-free (no window/document/timers; `declare global` banned —
  use a bare module-scoped `declare const` for `performance`). Its tsconfig enforces this.
- The 50k-node budget stands: no per-node-per-frame work that scales with total node
  count. Layout on data/options/open only, never on camera.
- ESM only, explicit `.js` import specifiers, TS pinned 5.9.x (vue-tsc can't do TS 7 yet),
  `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` on, `Array.from({length})`
  not `new Array(n)`.
- Don't push / force-move without the owner present (history was rewritten;
  `--force-with-lease` is their call).
