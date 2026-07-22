# OrgChart — remaining work (resume from `dev`)

Written before a context clear. This is the authoritative to-do for the next session.
Work continues on the `dev` branch. The full design is
`docs/superpowers/specs/2026-07-21-orgchart-rework-design.md`; the plans are in
`docs/superpowers/plans/`; the running list of unilateral choices is
`docs/superpowers/decisions-to-revisit.md`.

## Where things stand

Five packages, all green (~400 tests): `@n1crack/orgchart-core`, `@n1crack/orgchart`
(vanilla), `@n1crack/orgchart-vue`, `@n1crack/orgchart-react`, plus a private playground.
Everything runs from source through the pnpm workspace — no build step yet. `pnpm dev`
serves the playground; `pnpm test` / `pnpm typecheck` / `pnpm lint` from the root.

Implemented and working: the whole worker-backed Canvas2D pipeline, tidy layout,
orientations + RTL, quadtree cull + hit-test, in-house viewport, LOD tiers, text
measurement, theme, worker + main-thread fallback, SVG export, the vanilla DOM layer
(pointer, kinetic pan, pooled overlay, accessibility tree with full keyboard nav
including arrow-left/right, minimap silhouette, export, `setMinimap`, `setTheme`), the
Vue and React adapters, the two-phase expand/collapse transition with camera anchor and
overlay sync, the one-shot ring, and a redesigned sidebar playground with live controls.

## The one big feature still unbuilt for v1.0

### 1. Drag-and-drop reparenting
The spec (§11.1) promises it and it is the last missing feature. Core already has the
cycle guard: `wouldCreateCycle(tree, index, newParent)` and `reparent` semantics are
designed. What's missing is the whole interaction in the vanilla layer: pointer-drag a
node, draw a ghost, highlight the drop target via the main-thread quadtree, reject a drop
that would form a cycle (event reports `prevented`), and on a valid drop mutate the tree
with a dirty-subtree relayout and a tween. Touch: `packages/vanilla` (drag handling on
top of the existing input module), `packages/core` engine (a `reparent` mutation +
incremental relayout), events (`reparent`, and a `warning`/`prevented` path). Add it to
all three adapters' event surfaces. Playground: a draggable example.

## Release engineering (needed before npm)

### 2. Build + publish pipeline
Everything resolves from `.ts` source via each package's `exports` (with `publishConfig`
already carrying the intended `dist` paths). To actually publish:
- `tsdown` build per publishable package (core, vanilla, vue, react) → `dist` (ESM only).
  SFC `.d.ts` for Vue via `vue-tsc`.
- `changesets` for versioning + changelog.
- Wire `build` into turbo; the packages' `publishConfig.exports` already point at `dist`.
- One final release of the OLD `vue3-org-chart` npm package pointing at the new
  `@n1crack/orgchart-*` (README only) — optional.

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

## Verify the four-task polish actually landed (do this first next session)

The last agent (root-flash bug, reveal-from-bottom, transparent `blockFill` + control,
ring colour + on/off) should be merged by the time you read this. Confirm in the
playground: toggle the root and it must NOT flash; children emerge from a node's bottom
edge; zoomed out, the shape-only tier is transparent by default and colourable; the ring
can be turned off and recoloured. If any of those is wrong, that is the first fix.

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
