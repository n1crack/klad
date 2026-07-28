import { createChartHost, type ChartHost } from '@klad/engine/host'
import {
  applyOrientation,
  centreOn,
  createCanvas2DRenderer,
  dropPosition,
  isDropAllowed,
  resolveDropMode,
  subtreeMask,
  edgeStyleForLayout,
  isPolarLayout,
  resolveLayout,
  createTextMeasurer,
  DEFAULT_LOD,
  easeInOutCubic,
  fit as fitCamera,
  interpolate,
  computeSubtreeStats,
  normalize,
  overlayEnabled,
  pan,
  pruneToVisible,
  resolveTheme,
  subtreeOf,
  screenToWorld,
  toSVG as coreToSVG,
  toWireTree,
  worldToScreen,
  transitionAnchorProgress,
  zoomAt,
  type Bounds,
  type Camera,
  type DropMode,
  type ExportData,
  type Frame,
  type LayoutName,
  type LodThresholds,
  type NodeData,
  type Orientation,
  type RenderSurface,
  type Size,
  type SvgExportOptions,
  type Theme,
  type SubtreeStats,
  type Tree,
  type Warning,
  type ZoomLimits,
} from '@klad/engine'
import { createA11yTree, type A11yTree } from './a11y.js'
import { attachInput } from './input.js'
import { attachKeys } from './keys.js'
import { attachMarquee, pointInPolygon } from './marquee.js'
import { createMinimap, type Minimap, type MinimapOptions } from './minimap.js'
import { createDragGhost } from './drag-ghost.js'
import { createOverlay } from './overlay.js'

/**
 * Where a node sits in the tree and how much hangs off it. Handed to
 * `renderNode` on every card and returned by `api.stats`, so a template can
 * show "12 direct / 340 total" without walking anything: all four numbers are
 * precomputed once per tree (see core's `computeSubtreeStats`) and read here
 * as array lookups. Counting a subtree while drawing it would be O(subtree)
 * per node per frame, which is exactly the shape of work the 50k-node budget
 * rules out.
 *
 * All four describe the FULL tree, not the currently expanded part: a
 * collapsed branch's nodes still count. What a card shows is "this node has
 * 340 people under it", which does not change because the user folded it up.
 */
export interface NodeStats {
  /** Direct children. */
  directChildren: number
  /** Every node below this one, at any depth. A leaf is 0. */
  descendants: number
  /** Distance from the root: a root is 0. */
  depth: number
  /** How far the node's own subtree extends BELOW it: 0 for a leaf, 1 when
   * every child is a leaf. The mirror of `depth`, and a different question
   * from it. */
  height: number
  /**
   * Nested-set bounds: this node's pair brackets every pair below it.
   *
   * What they are for is the comparison they turn into. "Is this node inside
   * that branch" is otherwise a walk up the parent chain of unbounded length;
   * here it is two compares:
   *
   * ```ts
   * const branch = chart.stats('engineering')!
   * const node = chart.stats('lead-42')!
   * const inside = node.lft > branch.lft && node.rgt < branch.rgt
   * ```
   *
   * Strict on both sides, so a node is not inside itself. `rgt - lft` is
   * `2 * descendants + 1`, so the pair carries the subtree size too.
   *
   * The classic interleaved numbering rather than a half-open range, because
   * this is also what a database storing a hierarchy as nested sets uses —
   * which means these can go straight back after a drag reorders anything.
   * Numbered across the whole forest, so two roots' ranges never overlap.
   */
  lft: number
  rgt: number
}

export interface NodeContext extends NodeStats {
  id: string
  item: NodeData
  open: boolean
  /** Whether this node offers a way in — including one whose children have
   * not been fetched yet, which is what makes them reachable at all. See
   * `Options.mayHaveChildren`. */
  hasChildren: boolean
  /**
   * A `loadChildren` for this node is in flight.
   *
   * The chart cannot draw this for you: what a card looks like while it waits
   * is a decision about your card. All it can do is say when, which is this —
   * a spinner, a dimmed row, a "…" in place of the chevron, whatever suits.
   * Always `false` without `loadChildren`.
   */
  loading: boolean
  toggle(): void
}

export interface Options {
  data: NodeData[]
  /**
   * The box every node occupies, in world units — a fixed size, or a function
   * of the node for charts whose cards differ.
   *
   * Declared rather than measured, and that is not an oversight: layout runs
   * in a worker with no DOM, so there is nothing to measure at the moment the
   * tree is arranged. A card that overflows the size declared here is not
   * clipped — it simply overlaps its neighbours, because the layout that
   * spaced them apart was told a smaller number.
   *
   * Defaults to `DEFAULT_NODE_SIZE` (180x64), which is a readable name-and-role
   * card at 1:1 and lets a first chart be `{ data }` and nothing else.
   */
  nodeSize?: Size | ((item: NodeData) => Size)
  /**
   * The text the CANVAS draws inside a node — the label at every zoom where
   * text is legible but overlay cards are not (see `lodThresholds`), and the
   * only text at all when `renderNode` is absent.
   *
   * Defaults to the first of `name`, `label`, `title` the node actually
   * carries, falling back to its `id`. That default exists so a chart drawn
   * from ordinary data reads as a chart rather than a grid of empty boxes;
   * return `''` from your own function for a node that should stay blank.
   */
  label?: (item: NodeData) => string
  orientation?: Orientation
  /**
   * Which shape the tree is drawn in. Defaults to `'tidy'`, the tiered org
   * chart.
   *
   *  - `'tidy'`     — tiered, the 1.0 chart. The only one `orientation`
   *                   applies to.
   *  - `'file'`     — a file explorer: one indented row per node, with folder
   *                   guide lines. The one layout whose width does not grow
   *                   with the tree.
   *  - `'radial'`   — the root at the centre, generations as rings, names
   *                   radiating outward. For trees that are wide and shallow.
   *  - `'sunburst'` — the tree as a wheel of nested arc segments, coloured by
   *                   branch. Click a segment to drill into it; see `centre`.
   */
  layout?: LayoutName
  /**
   * Per-level step in world units, whose meaning depends on the layout: the
   * `file` indent, or the `radial`/`sunburst` ring thickness. Omitted, each
   * layout derives one from your `nodeSize`, so it scales with the cards.
   */
  layoutStep?: number
  /** `file` only: the gap between consecutive rows. Defaults to `spacing.y`. */
  rowGap?: number
  /**
   * `sunburst` only: the id of the node at the centre of the wheel, or `null`
   * (the default) for the root.
   *
   * Changing it — through this option or `setCentre` — is the drill-down: the
   * chosen branch widens to the full circle and travels inward to the centre
   * while everything else closes at the seam, and the frame does not move. It
   * is NOT `isolate`: nothing is pruned, so every node has somewhere to travel
   * and the change animates rather than cuts.
   */
  centre?: string | null
  /**
   * `sunburst` only: how many rings are drawn around the centre. Deeper nodes
   * are still there — drilling in reveals them — but are not drawn, so the
   * outermost ring stays thick enough to carry a label. Defaults to 3.
   */
  maxRings?: number
  /**
   * Whether a node has children, whether or not they are in `data` yet.
   *
   * Without it the chart can only know what it has been given, so a node whose
   * children have not been fetched is indistinguishable from a leaf: no mark,
   * no chevron, nothing to click. This is how a host says "there is more here"
   * for a tree it has not fully sent — typically from a count the API already
   * returns.
   *
   * ```ts
   * mayHaveChildren: (item) => Number(item.childCount) > 0
   * ```
   *
   * Only consulted for nodes with no children in `data`; a node that already
   * has some is not waiting for anything. "May" is the honest word — the host
   * is answering from a count, and a count can be wrong. A node that turns out
   * to have none after `loadChildren` returns simply becomes a leaf.
   *
   * Meaningless without `loadChildren`, and ignored without it: a mark
   * inviting a click that cannot lead anywhere is worse than no mark.
   *
   * Keep it cheap. It is called once per node whenever the data changes — a
   * property read or a comparison, not a lookup that walks something. At
   * twenty thousand nodes a trivial predicate costs well under a millisecond
   * and does not show; one that does real work per node would.
   */
  mayHaveChildren?: (item: NodeData) => boolean
  /**
   * Fetches one node's children, the first time it is opened.
   *
   * ```ts
   * loadChildren: (item) => fetch(`/api/children/${item.id}`).then((r) => r.json())
   * ```
   *
   * The chart keeps what you return — your `data` array stays as you gave it.
   * A `childrenLoaded` event fires with the same items if you want to persist
   * them yourself; you do not have to.
   *
   * Returned items are ordinary `NodeData`. A `parentId` you set is honoured,
   * so returning a whole subtree at once works; one you leave off is filled in
   * with the node being loaded, so the common case is just the children.
   *
   * The node opens when the children arrive, and the layout settles around
   * them rather than jumping — the same transition a drag uses. Until then it
   * is marked as loading, and it stays where it is on screen while the tree
   * grows underneath.
   *
   * A rejection is reported as a `load-failed` warning and leaves the node
   * unloaded, so clicking it again retries. Nothing is retried automatically:
   * a chart that re-fired a failing request on its own would do it for every
   * node the viewer touches.
   *
   * Only the single-node open paths ask for a load — a click, `expand(id)`,
   * the keyboard, a drag resting on the node. `expandAll()` and
   * `expand(id, true)` open what is already there and fetch nothing, because
   * "open everything" on a tree of unknown size is a request nobody means to
   * make.
   */
  loadChildren?: (item: NodeData) => NodeData[] | Promise<NodeData[]>
  /**
   * Drag a node — or the whole selection, if the node is in one — onto a new
   * parent, or between two siblings.
   *
   * Off by default: a chart is as often a read-only picture as an editor, and
   * a drag that silently restructures someone's org is a worse default than
   * one that pans. When on, dragging a node stops panning the camera; dragging
   * the background still does.
   *
   * The move is reported through `nodeDrop` before it is applied, and refusing
   * it there is how you veto one. Drops that would make a cycle — onto the
   * dragged node itself, or anything inside it — are refused by the chart and
   * never reach the event.
   */
  dragAndDrop?: boolean
  /**
   * Fill each node with its top-level branch's colour from `theme.palette`.
   * Omitted, the layout decides: on for `sunburst`, whose segments have
   * neither position nor connectors to carry structure, and off for every
   * other layout, where a plain card lets your own `renderNode` styling show.
   */
  colourBranches?: boolean
  rtl?: boolean
  spacing?: { x?: number; y?: number }
  lodThresholds?: LodThresholds
  collapsedByDefault?: boolean | ((item: NodeData) => boolean)
  theme?: Partial<Theme>
  /**
   * A filled silhouette of the occupied area plus a draggable viewport
   * rectangle (design doc §11.5) — not a shrunken chart: at minimap scale
   * individual boxes fall below a pixel and connectors vanish, so what's
   * useful is the shape of the tree, not a miniature redraw of it. Painted
   * once per relayout, never per frame; clicking or dragging inside it pans
   * the camera. `true` uses the default 200x140 size, bottom-right. Default
   * `false`.
   */
  minimap?: boolean | MinimapOptions
  zoomLimits?: ZoomLimits
  worker?: boolean
  renderNode?: (element: HTMLElement, context: NodeContext) => void
  /**
   * Governs every camera *animation* this layer produces on its own initiative:
   * the 200ms ease tween behind `focus`/`fit`/`reset`/`zoomTo`/`zoomIn`/`zoomOut`
   * and the accessibility layer's focus-follows-camera, the auto-pan-into-view
   * after a single-node expand/collapse, and kinetic panning's momentum coast
   * after a drag release. `false` makes all of these instantaneous — the camera
   * still moves, just without the animation. Defaults to `true`, but is
   * overridden to `false` whenever the OS reports `prefers-reduced-motion:
   * reduce`: an unrequested slide or coast is exactly what that setting exists
   * to suppress, so it is not treated as optional polish.
   */
  animate?: boolean
  /**
   * Keyboard control of the CAMERA: arrows pan, `+`/`-` zoom about the
   * centre, `f` fits, `0` resets, `Home` centres the root, `Escape` clears the
   * highlight. Turning this on is also what makes the host a tab stop, so the
   * chart can be reached from the keyboard at all.
   *
   * Separate from the accessibility tree, which is always present and moves
   * between NODES rather than moving the view (see `a11y.ts`). Defaults to
   * `true`; set `false` if the surrounding app binds these keys itself, or if
   * the host must not take focus.
   */
  keyboard?: boolean
  /**
   * Selecting nodes with the pointer: click to select, ctrl/cmd-click to add
   * or remove one, shift-click to add, shift-drag for a box and alt-drag for a
   * lasso. `Escape` clears it.
   *
   * Off by default, and that is a deliberate choice rather than caution: a
   * chart built before this existed has its own meaning for a click, and
   * turning every click into a selection underneath it would change what that
   * chart does without anyone asking. `select()` and the `selectionChange`
   * event work either way — this option is only about the POINTER.
   */
  selection?: boolean
  /**
   * After a single-node `expand`/`collapse` (not `expandAll`/`collapseAll`,
   * which always `fit()` — the whole chart changed, so a full fit is the
   * sensible response), pins the toggled node to a FIXED screen position for
   * the whole staged layout transition (see engine.ts's two-phase
   * choreography), rather than panning the camera TO it: the node is the
   * fixed point everything else grows out of or collapses back into, on- or
   * off-screen alike — the point is to hold what the user just acted on
   * still, not to move the camera at all. Zoom is never touched by this —
   * only the pan. Defaults to `true`.
   */
  autoPanOnToggle?: boolean
  /**
   * The one-shot confirmation ring (`theme.ringStroke`) that flashes on the
   * node a single-node `expand`/`collapse` just acted on. Some consumers
   * don't want it at all — a dense chart with frequent toggling can read the
   * repeated flash as noise rather than confirmation. `false` suppresses it
   * on every genuine single-toggle call site this layer has (`setOpenFlag`,
   * and the FIRST node of a deep `expand`/`collapse`) by passing `false`
   * through to `ChartHost.setOpen`'s own `ring` argument instead of this
   * layer's usual hardcoded `true` — the SAME per-call mechanism
   * `expandAll`/`collapseAll`/`expandTo` already use to opt individual calls
   * out (see engine.ts's `setOpen` docblock), just driven by this option
   * instead of "is this call the one the user acted on". Nothing else about
   * the toggle changes: the layout transition, camera anchor, and every
   * other effect of expanding/collapsing still run exactly as before —
   * only the ring itself is suppressed. Defaults to `true`.
   */
  ring?: boolean
  /**
   * When `true`, tapping a node with children expands or collapses it —
   * without this, a `renderNode` layout that has no room for its own toggle
   * button (a compact chip, a dense status card) has no way to be expanded
   * or collapsed at all. Defaults to `false`: existing consumers who render
   * their own toggle button (or rely on the a11y tree's Enter/Space
   * activation) get no behaviour change merely by upgrading.
   *
   * Contract, spelled out because this touches two other things a consumer
   * might already depend on:
   *  - **`nodeClick` still fires, unconditionally, before the toggle.** This
   *    option adds a side effect; it does not replace or gate the existing
   *    event. There is deliberately no way for a `nodeClick` listener to
   *    suppress the toggle (no `preventDefault`-style hook) — that keeps the
   *    contract simple: either enable this option and accept that a tap on a
   *    parent node toggles it, or leave it off and drive toggling yourself
   *    (from your own `nodeClick` handler, or a rendered button) exactly as
   *    before.
   *  - **A tap on genuinely interactive content inside a card — a `<button>`,
   *    `<a>`, `<input>`, `<select>`, `<textarea>`, or `[contenteditable]` —
   *    never toggles**, so a card's own toggle button (or any other control)
   *    keeps working exactly as it does today even with this turned on;
   *    only a tap that lands on the card's inert body (or bare canvas) does.
   *  - **A double click toggles once, not twice.** The toggle is wired into
   *    the same single-tap branch that emits `nodeClick` (see the
   *    `DOUBLE_CLICK_MS` handling below) — the second tap of a recognised
   *    pair already skips `nodeClick` in favour of `nodeDblClick`, so it
   *    skips the toggle for the same reason, with no separate bookkeeping.
   *  - **A leaf (no children) does nothing.** No `setOpen` call, no `toggle`
   *    event — there is nothing to toggle, so nothing is emitted.
   */
  toggleOnNodeClick?: boolean
}

export interface SearchResult {
  id: string
  item: NodeData
  path: string[]
}

/** Re-exported so a caller never has to reach past this package into core. */
export type ExportOpts = SvgExportOptions

export interface ToBlobOptions {
  format: 'png' | 'jpeg'
  /** Multiplies the canvas backing-store resolution — see `toBlob`'s docblock. Default 1. */
  scale?: number
}

export interface ChartState {
  nodeCount: number
  visibleCount: number
  camera: Camera
  bounds: Bounds
  /** Screen-space centre of the first root, for tests and for `focus`. */
  rootScreenCentre: { x: number; y: number }
  /** Whatever `highlight()` was last given, or `null`. */
  highlighted: string[] | null
  /** The node the chart is re-rooted at, or `null` for the whole tree. */
  isolated: string | null
  /** Ids of the selected nodes — see `select`. */
  selected: string[]
}

/**
 * Everything about WHERE A VIEWER IS, in one plain object: the camera, which
 * branches are open, and what is lit.
 *
 * Plain and serialisable on purpose — `JSON.stringify` it into a URL, a saved
 * report, or a "resume where I was". Ids rather than indices, so a view
 * survives the data being reordered, refetched, or grown; nodes it names that
 * are no longer in the tree are ignored rather than throwing, which is what
 * makes a bookmarked view still open a chart six months later.
 */
export interface ChartView {
  camera: Camera
  /** Ids of the nodes whose children are shown. */
  open: string[]
  /**
   * Optional, both of them, because a view is a thing people write by hand as
   * well as read back from `getView`: a link that says "open these branches,
   * here" should not have to say "and nothing is selected or isolated" to be
   * valid. `getView` always fills them in; `setView` treats absent as none.
   */
  highlighted?: string[] | null
  /** The node the chart is re-rooted at, or `null` — see `isolate`. */
  isolated?: string | null
  /** Ids of the selected nodes — see `select`. */
  selected?: string[]
}

/**
 * What `nodeDrop` carries — see the event's own docblock in `KladEvents`.
 *
 * Named and exported rather than left inline on the event, because a handler
 * is a function a host has to declare somewhere, and typing its parameter
 * should not mean digging the shape back out of `KladEvents['nodeDrop']`.
 * Every adapter re-exports it.
 */
export interface NodeDropEvent {
  ids: string[]
  items: NodeData[]
  parentId: string | null
  index: number
  mode: DropMode
  preventDefault: () => void
}

export interface KladEvents {
  nodeClick: (event: { id: string; item: NodeData }) => void
  /**
   * The selection changed — by a click, a region drag, or `select()`. Carries
   * the whole selection rather than a delta: every consumer of this so far
   * wants "what is selected now", and a delta makes them rebuild that
   * themselves.
   */
  selectionChange: (event: { ids: string[]; items: NodeData[] }) => void
  /**
   * Fires with `{ id, item }` the instant the pointer enters a node, and with
   * `{ id: null, item: null }` when it leaves all nodes (including plain
   * canvas background). Never fires twice in a row for the same id — moving
   * within a single node's box is not a re-entry.
   */
  nodeHover: (event: { id: string; item: NodeData } | { id: null; item: null }) => void
  /**
   * Fires with `{ id, item }` when two taps land on the same node within the
   * platform double-click window. See the `DOUBLE_CLICK_MS` comment in
   * `index.ts` for why the second tap of the pair does not also emit a second
   * `nodeClick`.
   */
  nodeDblClick: (event: { id: string; item: NodeData }) => void
  /**
   * A node was dropped somewhere new. Fires BEFORE anything moves.
   *
   * Call `preventDefault()` to refuse it — a server rejected the move, a
   * business rule forbids it, you want to confirm first. Otherwise the chart
   * applies it as soon as the handler returns, and the layout transition
   * animates the result.
   *
   * `ids` is the whole selection when a selected node was dragged, in the
   * order they appear in the tree, so a handler applying the move to its own
   * array does not have to work out the ordering itself. `parentId` is `null`
   * for a drop that makes a node a root. `index` is the position among the new
   * parent's children BEFORE the moving nodes are removed — see
   * `dropPosition` in core.
   */
  nodeDrop: (event: NodeDropEvent) => void
  /**
   * `loadChildren` returned, and the chart has taken the children in.
   *
   * Purely informational — the chart holds them either way, so a host that
   * does not need to persist anything can ignore this. `items` is exactly what
   * the loader returned, before the chart filled in any missing `parentId`.
   *
   * A load that failed does not fire this; it arrives as a `load-failed`
   * warning instead.
   */
  childrenLoaded: (event: { id: string; item: NodeData; items: NodeData[] }) => void
  toggle: (event: { id: string; open: boolean }) => void
  viewportChange: (event: { camera: Camera }) => void
  warning: (warning: Warning) => void
  ready: () => void
}

export interface KladApi {
  zoomTo(k: number): void
  zoomIn(): void
  zoomOut(): void
  fit(): void
  /**
   * Frames one branch instead of the whole chart: the smallest camera that
   * shows `id` and everything currently visible below it.
   *
   * The distinction that makes this worth having separately from `fit()` is
   * scale. On a chart of tens of thousands of nodes, fitting everything means
   * a zoom level where nothing can be read — "show me Engineering" is the
   * question people actually have, and this is its answer.
   *
   * Counts only what is on screen-able: a collapsed branch inside the subtree
   * contributes nothing, because framing space for nodes the viewer cannot
   * see would leave the ones they can see smaller than they need to be. Does
   * nothing for an unknown id, or for one that is itself collapsed away.
   */
  fitSubtree(id: string): void
  /**
   * Shows one branch AS the chart: `id` becomes the root, its ancestors and
   * every other branch stop existing as far as the layout, the minimap, the
   * keyboard tree, search and export are all concerned. `null` restores the
   * whole tree.
   *
   * Different from `fitSubtree`, which only points the camera at a branch —
   * everything else is still there, just off screen. Isolating is the answer
   * when "everything else" is forty thousand nodes and their presence is what
   * makes the chart unusable: layout has less to arrange, the minimap shows
   * the branch rather than a speck inside a company, and Tab walks the branch
   * instead of the org.
   *
   * The host is left to say where the viewer is — `pathTo(id)` returns the
   * chain from the real root, which is a breadcrumb.
   */
  /**
   * Centres a sunburst on one node — the drill-down — or `null` for the root.
   *
   * The chosen branch widens to the whole circle and travels inward while
   * everything else closes at the seam, over about 600ms. Nothing is pruned
   * and the camera does not move: a sunburst's frame is the same square
   * whatever is at its centre, which is what makes this read as zooming into
   * the chart rather than as loading a different one.
   *
   * A no-op on every other layout, and on an id this chart doesn't have.
   * Pair it with `getCentre` and each node's ancestor chain to build a
   * breadcrumb.
   */
  setCentre(id: string | null): void
  /** The id currently at the centre of the wheel, or `null` for the root. */
  getCentre(): string | null
  isolate(id: string | null): void
  reset(): void
  /**
   * Puts `id` on screen, opening every collapsed ancestor on the way so it
   * has somewhere to be — the "go to node X" command, which has to work from
   * a fully collapsed chart.
   *
   * The camera move waits for the frame that actually has the post-expand
   * layout. It cannot be computed synchronously: expanding the ancestors
   * dirties the layout, and until it is rebuilt a node that was hidden has no
   * box at all — which is why this used to do nothing whatsoever when the
   * target was collapsed away, the exact case it exists for.
   *
   * `ring` flashes the one-shot confirmation ring on arrival, an "you are
   * here" marker for a caller that jumped somewhere the user did not click.
   * Off by default: a caller stepping through search results in a loop wants
   * the camera moved, not a flash per step. Honoured only when animation is
   * enabled, like every other ring.
   */
  focus(id: string, opts?: { ring?: boolean }): void
  expand(id: string, deep?: boolean): void
  collapse(id: string, deep?: boolean): void
  expandAll(): void
  collapseAll(): void
  expandTo(id: string): void
  /**
   * Every node matching a label substring or a predicate, with the ancestor
   * chain that leads to each. Case-insensitive for the string form.
   *
   * A QUERY: it changes nothing — not the camera, not what is drawn, not the
   * expand state. That is what makes it the thing you build the other
   * commands out of: feed a result's id to `focus`, or its whole set to
   * `highlight`, or the same predicate to `filter`.
   *
   * Scans the WHOLE tree, including branches that are collapsed, isolated
   * away or removed by a filter. Deliberately: "is there a Rossi anywhere in
   * this company" is not a question about the current view, and a search that
   * could only find what was already on screen would be no use for getting to
   * what is not.
   */
  search(query: string | ((item: NodeData) => boolean)): SearchResult[]
  /**
   * Reduces the chart to the nodes that match, plus the ancestors that lead to
   * them. `null` clears it. Returns the ids that MATCHED — not everything left
   * on screen, which also includes those ancestors.
   *
   * ```ts
   * chart.api.filter('schema')                       // by label
   * chart.api.filter((item) => item.status === 'open')
   * chart.api.filter(null)                           // back to the whole tree
   * ```
   *
   * A match's own children are hidden unless they match too. The question a
   * filter answers is "where are the things I asked for", and answering it
   * with their subtrees attached puts back most of what was taken away.
   *
   * Overrides collapse: results behind a closed ancestor would be a filter
   * that did not show you what it found. Expand state is untouched underneath
   * and comes back when the filter is cleared.
   *
   * Unlike `search`, which is a query that changes nothing, this changes what
   * the chart IS — it prunes and relayouts, the way `isolate` does, so the
   * minimap, the keyboard tree and the exports all agree with what is drawn.
   * A filtered chart is also refitted, since whatever the camera was framing
   * has moved or gone.
   */
  filter(query: string | ((item: NodeData) => boolean) | null): string[]
  /**
   * Where `id` sits in the tree and how much hangs off it — see `NodeStats`.
   * `null` for an id this chart doesn't have. The same numbers `renderNode`
   * receives, for a caller driving its own UI (a sidebar, a breadcrumb, a
   * summary line) rather than a card.
   */
  /**
   * Re-reads `nodeSize` and `label` for every node and relayouts around the
   * new measurements, keeping expand/collapse state, camera and highlight
   * exactly as they are.
   *
   * `nodeSize` is declared, never measured — layout runs in a worker with no
   * DOM (see the README) — so a card that changes its own height, an
   * accordion opening or a badge appearing, has to say so. `update()` is the
   * wrong tool for it: that replaces the data and resets the tree's open
   * state, throwing away exactly what the user was looking at.
   *
   * The relayout snaps rather than animating: this is a re-measure, not a
   * toggle, and there is no single node for a transition to be anchored on.
   */
  refresh(): void
  stats(id: string): NodeStats | null
  /**
   * The chain of ids from the root down to `id`, inclusive of both — what to
   * paint to show the way to a node (`highlight(api.pathTo(id) ?? [])`), or
   * to render as a breadcrumb. `null` for an id this chart doesn't have; a
   * root returns just itself.
   */
  pathTo(id: string): string[] | null
  highlight(ids: string[] | null): void
  /**
   * The SELECTED nodes — what the viewer picked, as opposed to what
   * `highlight` says the chart is pointing at. `null` or `[]` clears it.
   *
   * Two separate concepts on purpose, and they co-occur constantly: select
   * three people, then search, and a chart that drew both the same way would
   * have thrown away which was which. Selection is also what a later drag
   * moves — a person drags a selection, not a node.
   *
   * Unknown ids are ignored, so a caller can hand back a list from data it no
   * longer has without checking first.
   */
  select(ids: string[] | null): void
  /** The current selection, in the order it was given. */
  getSelection(): string[]
  /**
   * Serializes the whole VISIBLE tree (collapsed branches excluded, same rule
   * as everywhere else) to a standalone SVG document string — vector,
   * resolution-independent, real selectable `<text>`. Never reads a canvas
   * pixel; see `render/svg.ts` in core.
   */
  toSVG(opts?: ExportOpts): string
  /**
   * Redraws the whole visible tree to an offscreen canvas at `scale` DPI and
   * returns the encoded image as a `Blob` — a correct document at whatever
   * size was asked for, not a screenshot of wherever the camera happened to
   * be. See `toBlob`'s docblock in index.ts for why this never rasterizes
   * the SVG string.
   */
  toBlob(opts: ToBlobOptions): Promise<Blob>
  /** Writes the SVG export into a hidden iframe and prints it. */
  print(): void
  /**
   * Turns the minimap on or off after construction, without the tree-state
   * reset that routing this through `update()` would cause. Passing an options
   * object also repositions or resizes it.
   */
  setMinimap(minimap: boolean | MinimapOptions): void
  /**
   * Merges `partial` over the CURRENT theme (not the built-in defaults —
   * a previous `setTheme` call's tokens stay in place unless this one
   * overrides them too), re-resolves it, and repaints. Paint-only, like
   * `setMinimap`: it never touches tree/layout state, so camera position,
   * expand/collapse state and scroll position are all untouched — unlike the
   * remount a caller had to do for this before this method existed. Takes
   * effect on the very next frame; if a transition is mid-flight, it keeps
   * animating with the new theme's colours from that frame on.
   */
  setTheme(theme: Partial<Theme>): void
  /**
   * Turns the one-shot confirmation ring on or off after construction,
   * without the tree-state reset routing this through `update()` would
   * cause — same reasoning as `setMinimap`. Takes effect on the very next
   * single-node `expand`/`collapse`; an already-flashing ring finishes its
   * current fade rather than being cut off mid-flight. See `Options.ring`'s
   * docblock for exactly which call sites this governs.
   */
  setRing(enabled: boolean): void
  /**
   * Changes how the tree is ARRANGED, after construction — the shape itself,
   * and every knob that tunes it.
   *
   * The alternative is `update(data, options)`, which replaces the data and
   * therefore resets every node's open/closed state: dragging an indent
   * slider is not a reason to re-collapse a tree the viewer just opened. Same
   * reasoning as `setTheme` and `setMinimap`; this is the layout-shaped hole
   * in that set.
   *
   * Only these keys, and deliberately so. `nodeSize` and `label` are read
   * per node at layout time and belong to `refresh()`; `renderNode` is a
   * construction-time choice in every adapter. What is here is what a viewer
   * would put on a slider.
   *
   * Does NOT move the camera by default: a chart that jumped to a fit on
   * every tick of a slider is unusable as a control. But every one of these
   * knobs changes how big the drawing is, so a caller driving a slider will
   * want to settle the view once the drag ends — pass `{ fit: true }` for
   * that, and the fit happens AFTER the relayout lands rather than against
   * the bounds it is about to replace. (Calling `fit()` yourself right after
   * this returns frames the OLD geometry: the relayout is deferred to the
   * next frame, which is what keeps a drag cheap.)
   */
  setLayoutOptions(settings: LayoutSettings, opts?: { fit?: boolean }): void
  getState(): ChartState
  /**
   * Where the viewer is, as a plain serialisable object — see `ChartView`.
   * Pair with `setView` for a shareable link, a saved report, or a way back
   * to where someone was before they navigated away.
   */
  getView(): ChartView
  /**
   * Restores a view from `getView`. Ids that are no longer in the tree are
   * ignored rather than throwing: a view saved six months ago should still
   * open the chart, showing what is left of what it named.
   *
   * `animate` defaults to `false` — restoring a view is arriving somewhere,
   * not travelling there, and a viewer who just opened a link has no memory
   * of the previous position for the motion to relate to. Pass `true` when
   * moving between views WITHIN a session, where the flight is the thing that
   * tells them they moved.
   */
  setView(view: ChartView, opts?: { animate?: boolean }): void
}

/**
 * The subset of `Options` that decides how the tree is arranged — everything
 * `setLayoutOptions` can change live. A strict subset of `Options`, so a
 * caller can hold one object and spread it into both.
 */
export type LayoutSettings = Pick<
  Options,
  'layout' | 'layoutStep' | 'rowGap' | 'maxRings' | 'colourBranches' | 'spacing' | 'orientation' | 'rtl'
>

export interface KladInstance {
  destroy(): void
  update(data: NodeData[], options?: Partial<Options>): void
  subscribe(callback: (state: ChartState) => void): () => void
  on<E extends keyof KladEvents>(event: E, callback: KladEvents[E]): () => void
  readonly api: KladApi
}

const DEFAULT_LIMITS: ZoomLimits = { minK: 0.05, maxK: 4 }

/**
 * The node box used when `nodeSize` is not given: wide enough for a name and a
 * role at the default label size, short enough that a few hundred nodes still
 * fit a screen once zoomed out. Exported because a consumer sizing their own
 * cards around it should not have to guess the number this layer would have
 * used — and because a card whose CSS disagrees with the box under it is the
 * one mistake this option makes easy.
 */
export const DEFAULT_NODE_SIZE: Size = { w: 180, h: 64 }

/**
 * The label used when `label` is not given: whichever of `name`, `label` or
 * `title` the node actually has, else its id.
 *
 * A chart's data almost always carries one of those three, and requiring a
 * one-line accessor before anything shows up made "here is your data" a
 * two-step. Falling back to the id rather than to nothing keeps a node
 * identifiable even when the data is shaped in some fourth way — an empty box
 * tells the reader neither what it is nor that they need to say.
 */
function defaultLabel(item: NodeData): string {
  for (const key of ['name', 'label', 'title'] as const) {
    const value = item[key]
    if (typeof value === 'string' && value !== '') return value
    if (typeof value === 'number') return String(value)
  }
  return String(item.id)
}

/** Screen-space breathing room left around the chart by `fit()`. */
const FIT_PADDING = 32

/**
 * World-unit margin around the exported bounds, shared by `toSVG` (as
 * `render/svg.ts`'s own default) and `toBlob` (applied by hand below, since
 * `Frame`/`createCanvas2DRenderer` has no padding concept of its own) — kept
 * equal so the two export forms frame the chart the same way.
 */
const EXPORT_PADDING = 16

// Reused across every `toBlob` call rather than allocated per call: a "whole
// visible tree" frame never has ghosts or an active ring (those are
// transition-in-progress concepts that don't apply to a static export
// snapshot), so these are always empty/inert. Explicitly annotated with the
// bare (`ArrayBufferLike`-backed) typed-array form per the brief: under
// TS 5.9 a bare `new Float64Array(0)` infers the narrower `Float64Array<ArrayBuffer>`,
// which `Frame`'s fields (typed against the wider form) don't accept without
// this annotation.
const EMPTY_GHOST_BOXES: Float64Array = new Float64Array(0)
const EMPTY_GHOST_ALPHA: Float32Array = new Float32Array(0)
const INERT_RING_BOX: Float64Array = new Float64Array(4)

export function createKlad(host: HTMLElement, options: Options): KladInstance {
  // Mutable so `api.setTheme` can swap it in place — `createChartHost`
  // captures this same value at construction, and every later reader (the
  // `toBlob` export renderer below, `api.setTheme` itself) closes over this
  // binding rather than a snapshot, so reassigning it here is exactly what a
  // live theme update needs. See `api.setTheme` for the merge-and-repaint
  // side of this.
  let theme = resolveTheme(options.theme)
  const configuredLimits = options.zoomLimits ?? DEFAULT_LIMITS

  /**
   * The zoom floor has to be able to move. A wide org chart is far larger than any
   * viewport — 200 nodes at a fan-out of six is already ~30,000px across — so a fixed
   * `minK` means the Fit button cannot actually fit, which is worse than useless
   * because it looks broken. The floor is therefore lowered to whatever "show me
   * everything" requires, and no further, so ordinary zooming out still stops at the
   * configured limit on charts that comfortably fit.
   */
  let limits: ZoomLimits = { ...configuredLimits }

  const recomputeLimits = (): void => {
    const rect = host.getBoundingClientRect()
    const w = bounds.maxX - bounds.minX
    const h = bounds.maxY - bounds.minY
    if (w <= 0 || h <= 0 || rect.width <= 0 || rect.height <= 0) return
    const needed = Math.min(
      Math.max(1, rect.width - FIT_PADDING * 2) / w,
      Math.max(1, rect.height - FIT_PADDING * 2) / h,
    )
    limits = { minK: Math.min(configuredLimits.minK, needed), maxK: configuredLimits.maxK }
  }
  const lod = options.lodThresholds ?? DEFAULT_LOD

  // The overlay, the minimap and the drag ghost are all absolutely positioned
  // inside the host, so the host has to be a containing block. Any positioning
  // makes it one, so this only steps in when there is none.
  //
  // Read from the COMPUTED style, not the inline one. `host.style.position` is
  // only what an inline attribute says, so a host positioned by a stylesheet —
  // `.chart { position: absolute; inset: 0 }`, the ordinary way to make an
  // element fill its parent — read as unpositioned and got an inline
  // `relative` written over the top of it. Inline wins over a stylesheet, so
  // the rule was not overridden, it was silently defeated: the element
  // collapsed to its content height, the canvas sized itself to that, and the
  // minimap anchored to the bottom of a chart that ended halfway up the page.
  const positioned = host.isConnected ? getComputedStyle(host).position : host.style.position
  if (positioned === '' || positioned === 'static') host.style.position = 'relative'
  host.style.overflow = 'hidden'

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  host.appendChild(canvas)

  const overlayRoot = document.createElement('div')
  overlayRoot.className = 'klad-overlay'
  overlayRoot.style.position = 'absolute'
  overlayRoot.style.inset = '0'
  overlayRoot.style.pointerEvents = 'none'
  host.appendChild(overlayRoot)

  let currentOptions = options
  /**
   * What the tree is built from: the host's array, plus everything
   * `loadChildren` has returned.
   *
   * Declared before `tree` and used by every `normalize` call in this file, so
   * there is exactly one answer to "what is in this chart" — a second rebuild
   * that forgot the loaded children would silently throw away every branch the
   * viewer had opened.
   *
   * Children come after the host's own items rather than being spliced in
   * beside their parent. `normalize` orders siblings by their appearance in
   * the array, and every child of one parent arrives in one batch, so a batch
   * appended whole keeps its own order — which is the order the loader
   * returned, and the only order anyone has expressed an opinion about.
   */
  const treeSource = (): NodeData[] => {
    if (loadedChildren.size === 0) return currentOptions.data
    const all = [...currentOptions.data]
    for (const [parentId, items] of loadedChildren) {
      for (const item of items) {
        // A `parentId` the loader set wins, so returning a whole subtree in
        // one call works. One it left off is the common case — "here are the
        // children of the node you asked about" — and filling it in is what
        // makes that call as short as it reads.
        all.push(item.parentId === undefined ? { ...item, parentId } : item)
      }
    }
    return all
  }

  let tree: Tree = normalize(options.data)
  // Computed once per tree, never per frame and never per node on demand —
  // see `computeSubtreeStats` in core. Every consumer below (`renderNode`'s
  // context, `api.stats`) is then a plain array lookup.
  let stats: SubtreeStats = computeSubtreeStats(tree)
  let open = new Uint8Array(tree.count)
  let camera: Camera = { x: 0, y: 0, k: 1 }
  // Explicitly annotated: under TS 5.9, `new Uint32Array(0)` infers
  // `Uint32Array<ArrayBuffer>`, but ChartHost's methods return/expose the wider
  // `Uint32Array<ArrayBufferLike>` (same for Float64Array/Int32Array below).
  // Annotating the binding, rather than casting at each assignment, is what the
  // brief calls for here.
  let drawn: Uint32Array = new Uint32Array(0)
  let boxes: Float64Array = new Float64Array(0)
  let visibleToSource: Int32Array = new Int32Array(0)
  let bounds: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let frameRequested = false
  let destroyed = false

  /**
   * Source index -> this frame's INTERPOLATED box, rebuilt every frame from
   * `chartHost.lastDrawnBoxes` (which is aligned 1:1 with `drawn` — see its
   * docblock in `worker/host.ts`) — `null` whenever no transition is
   * running, in which case every consumer below falls back to the ordinary
   * final-layout `boxOfSource`. Bounded to `drawn.length` (the near-viewport
   * drawn set), never total node count, matching the 50k budget: this is
   * exactly the same set the canvas itself just painted with these exact
   * positions, so nothing here scans, or even sizes itself against, the
   * whole tree.
   */
  let renderBoxBySource: Map<number, { x: number; y: number; w: number; h: number }> | null = null

  /**
   * Source index -> this frame's REVEAL ALPHA, rebuilt every frame from
   * `chartHost.lastDrawnAlpha` exactly the way `renderBoxBySource` is
   * rebuilt from `lastDrawnBoxes` — `null` whenever nothing on screen is
   * fading, which is the whole steady state and every collapse, in which
   * case every node is fully opaque.
   *
   * The overlay needs this because an expand is STAGED (see engine.ts): its
   * first phase makes room while the newly revealed children stay hidden at
   * alpha 0, and only the second reveals them. Without it the canvas honours
   * that and the DOM cards do not, so a revealed child's card sits at full
   * opacity on a zero-size box at its parent's edge for the whole first
   * phase — small bubbles hanging off the parent until the reveal starts.
   */
  let renderAlphaBySource: Map<number, number> | null = null

  let minimap: Minimap | null = null
  // Identity check, not a dirty flag some mutation sets: `chartHost.boxes` is
  // a fresh array only on an actual relayout (see engine.ts's `layout()`),
  // so comparing references is exactly "did the layout change" — the same
  // trick already used for `visibleToSource` below. Reset to `null` whenever
  // the minimap is (re)created so the very next frame always paints it, even
  // if the layout array reference happens not to have changed since it was
  // last read.
  let lastMinimapBoxes: Float64Array | null = null

  const stateListeners = new Set<(state: ChartState) => void>()
  const eventListeners = new Map<string, Set<(payload: never) => void>>()

  const emit = <E extends keyof KladEvents>(
    event: E,
    ...payload: Parameters<KladEvents[E]>
  ): void => {
    for (const listener of eventListeners.get(event) ?? []) {
      ;(listener as (...args: unknown[]) => void)(...payload)
    }
  }

  const chartHost: ChartHost = createChartHost(canvas, theme, options.worker !== false)

  const sizeOf = (item: NodeData): Size => {
    const declared = currentOptions.nodeSize
    if (declared === undefined) return DEFAULT_NODE_SIZE
    return typeof declared === 'function' ? declared(item) : declared
  }

  const labelOf = (item: NodeData): string =>
    currentOptions.label === undefined ? defaultLabel(item) : currentOptions.label(item)

  /**
   * Pushes the tree, every node's size and label, and the current open flags
   * down to the engine, then relayouts.
   *
   * `emitWarnings` is false for a plain refresh: the warnings belong to
   * `normalize`'s reading of the DATA, and re-announcing the same ones every
   * time a caller re-measures would turn a one-time diagnostic into a stream.
   */
  const applyData = (emitWarnings = true): void => {
    const sizes = new Float64Array(tree.count * 2)
    const labels: string[] = Array.from({ length: tree.count })
    for (let i = 0; i < tree.count; i++) {
      const item = itemFor(i)
      const size = sizeOf(item)
      sizes[i * 2] = size.w
      sizes[i * 2 + 1] = size.h
      labels[i] = labelOf(item)
    }
    // Options FIRST, then the data. The order matters on the very first pass:
    // each of these relayouts, and whichever runs last is the geometry the
    // mount-time `fit()` frames. Sending the data first laid the tree out with
    // the DEFAULT layout, published those bounds, and only then switched to
    // the one the caller actually asked for — so a chart that opened as, say,
    // a sunburst was fitted to the bounds of a tidy tree it never drew, and
    // came up off-centre and at the wrong zoom until something else forced a
    // refit.
    chartHost.setOptions({
      spacingX: currentOptions.spacing?.x ?? 16,
      spacingY: currentOptions.spacing?.y ?? 48,
      orientation: currentOptions.orientation ?? 'tb',
      rtl: currentOptions.rtl ?? false,
      layout: currentOptions.layout ?? 'tidy',
      layoutStep: currentOptions.layoutStep,
      rowGap: currentOptions.rowGap,
      maxRings: currentOptions.maxRings,
      colourBranches: currentOptions.colourBranches,
      // Resolved here rather than in the engine because the engine addresses
      // nodes by index and a caller names them by id. An id this chart doesn't
      // have resolves to -1, the default centre, which is also what `null`
      // means — a wheel is never left centred on nothing.
      focus: centreIndex(),
      lod,
    })
    // Built once and handed to both consumers. It calls the host's
    // `mayHaveChildren` per node, so on a tree big enough to care that is
    // twenty thousand calls into somebody else's code — worth not doing
    // twice in the same function for the sake of a shorter line.
    const unloaded = unloadedMask()
    chartHost.setData(toWireTree(tree), sizes, labels, open, unloaded)
    // After `setData`, because the mask is indexed against the tree that was
    // just sent. Re-derived rather than kept: a source index means nothing
    // across a `normalize`, so carrying the old mask over would keep an
    // arbitrary set of nodes.
    if (filterQuery !== null) applyFilter()
    // Deferred: applyData() runs synchronously inside createKlad, before the
    // caller has had a chance to attach a 'warning' listener via `on()`. Emitting
    // here directly would drop every warning raised on the initial load. Queuing
    // a microtask defers emission until after the constructor returns (and after
    // any `on()` call the caller makes in the same synchronous tick), while still
    // running well before the next animation frame.
    const warnings = emitWarnings ? tree.warnings : []
    if (warnings.length > 0) {
      queueMicrotask(() => {
        for (const warning of warnings) emit('warning', warning)
      })
    }
    a11y?.update(tree, open, (index) => labelOf(itemFor(index)), isolatedIndex, unloaded, filterKeep)
  }

  /** `options.centre` as a source index, or -1 for "the default centre" —
   * which covers `null`, an omitted option, and an id this chart doesn't
   * have. */
  const centreIndex = (): number => {
    const id = currentOptions.centre
    return id === undefined || id === null ? -1 : (tree.idToIndex.get(id) ?? -1)
  }

  /** `collapsedByDefault`, resolved for one item. Shared by `initOpen` and by
   * the nodes a load brings in, which have to start the same way they would
   * have if they had been in `data` from the beginning. */
  const collapsedFor = (item: NodeData): boolean => {
    const collapsed = currentOptions.collapsedByDefault
    if (collapsed === true) return true
    if (typeof collapsed === 'function') return collapsed(item)
    return false
  }

  /**
   * Whether a node starts open — `collapsedByDefault`, with one node type it
   * cannot override.
   *
   * A node whose children have not been fetched starts CLOSED whatever the
   * option says, because "open" is a claim about what is on screen and an
   * unloaded node has nothing to show. Left open it would report itself
   * expanded to a screen reader while displaying nothing, and — worse — the
   * only thing that asks for a load is opening it, so a node that was already
   * open could never be fetched at all. Closed, it carries the "more inside"
   * mark and one click both loads and opens it.
   */
  const opensByDefault = (index: number): boolean =>
    !collapsedFor(itemFor(index)) && !isUnloaded(index)

  const initOpen = (): void => {
    open = new Uint8Array(tree.count)
    for (let i = 0; i < tree.count; i++) open[i] = opensByDefault(i) ? 1 : 0
  }

  // Both of these are consulted per node per frame, so neither may scan.
  // A `data.find()` or a linear search over `visibleToSource` here costs
  // O(nodes) inside an O(visible) loop, which is what turns a 50k chart into a
  // slideshow. Both maps are rebuilt only when their source changes.
  let itemById = new Map<string, NodeData>()
  const rebuildItemIndex = (): void => {
    // `treeSource()`, not `currentOptions.data`: everything `normalize` was
    // given has to be findable here, or a loaded node falls through
    // `itemFor`'s `{ id }` fallback and every per-item callback — `label`,
    // `nodeSize`, `renderNode` — is handed a stub with nothing on it but its
    // id. Which is exactly what a fetched row then draws.
    itemById = new Map(treeSource().map((item) => [item.id, item]))
  }

  const itemFor = (index: number): NodeData => {
    const id = tree.indexToId[index]!
    return itemById.get(id) ?? { id }
  }

  let sourceToPruned = new Map<number, number>()
  const rebuildPrunedIndex = (): void => {
    sourceToPruned = new Map()
    for (let i = 0; i < visibleToSource.length; i++) sourceToPruned.set(visibleToSource[i]!, i)
  }

  // --- drag and drop ---------------------------------------------------
  //
  // The pointer half of 1.3. The decisions — what a position over a node
  // means, and whether the drop is legal — live in core (`drag/drop-target`)
  // and are pure; this is the gesture, the preview state, and the event.

  /** The nodes this drag is carrying, by id. Empty when nothing is dragging. */
  let dragIds: string[] = []
  const dragGhost = createDragGhost(host)
  /**
   * Auto-pan while a drag sits near an edge.
   *
   * Without it a drop is only possible onto something already on screen, which
   * on a chart big enough to need dragging is most of the time the wrong
   * place. The pointer is held still by the viewer; the CHART moves under it,
   * which is the same gesture every file manager and calendar uses for the
   * same reason.
   */
  let edgePan: { x: number; y: number } = { x: 0, y: 0 }
  let edgePanFrame: number | null = null
  /**
   * A mask over SOURCE indices marking everything the drag carries, built
   * once at drag start. Source rather than pruned because the gesture outlives
   * a relayout: a drag that hovers over a collapsed folder long enough for it
   * to spring open would otherwise be testing against an index space that no
   * longer exists.
   */
  let dragMask: Uint8Array | null = null
  /** What the preview is currently showing — mirrored here because the engine
   * takes it as three arguments and `onDragEnd` needs to read back what the
   * last move decided. */
  let dropTargetIndex = -1
  let dropTargetMode: DropMode = 'into'
  let dropTargetValid = true

  /** Screen px from the edge within which a drag starts panning, and how fast
   * it goes at the very edge (px per frame). */
  const EDGE_ZONE_PX = 56
  const EDGE_SPEED_PX = 14

  const stepEdgePan = (): void => {
    edgePanFrame = null
    if (edgePan.x === 0 && edgePan.y === 0) return
    setCameraInstant(pan(camera, -edgePan.x, -edgePan.y))
    edgePanFrame = requestAnimationFrame(stepEdgePan)
  }

  /** How hard to pan, given where the pointer is in the host. Ramps with depth
   * into the zone rather than switching on: a fixed speed the moment you cross
   * a line feels like the chart lurching away from you. */
  const updateEdgePan = (screenX: number, screenY: number): void => {
    const rect = host.getBoundingClientRect()
    const axis = (position: number, extent: number): number => {
      if (position < EDGE_ZONE_PX) return -(1 - position / EDGE_ZONE_PX) * EDGE_SPEED_PX
      const fromEnd = extent - position
      if (fromEnd < EDGE_ZONE_PX) return (1 - fromEnd / EDGE_ZONE_PX) * EDGE_SPEED_PX
      return 0
    }
    edgePan = { x: axis(screenX, rect.width), y: axis(screenY, rect.height) }
    if ((edgePan.x !== 0 || edgePan.y !== 0) && edgePanFrame === null) {
      edgePanFrame = requestAnimationFrame(stepEdgePan)
    }
  }

  const stopEdgePan = (): void => {
    edgePan = { x: 0, y: 0 }
    if (edgePanFrame !== null) cancelAnimationFrame(edgePanFrame)
    edgePanFrame = null
  }

  /**
   * The cursor, for as long as a drag is running.
   *
   * Set inline on the chart's own two elements rather than left to a
   * stylesheet, because the cursor is the answer to "will this be taken?" and
   * a library whose only refusal signal is a class the host has to style
   * themselves has not actually answered it. `klad-dragging` and
   * `klad-drag-refused` are still set alongside, for a host that wants a
   * different look; this is the floor, not the ceiling.
   */
  const setDragCursor = (cursor: string): void => {
    host.style.cursor = cursor
    canvas.style.cursor = cursor
    // Cards stop taking pointer events for the length of the drag. Two
    // reasons, and both are about the drag rather than the cursor: a card's
    // own `cursor` would otherwise win over the host's inside its bounds, and
    // a button or link in a card has no business receiving hover states from
    // a pointer that is carrying a node. Hit-testing is unaffected — it runs
    // against the layout on this thread, and the gesture is tracked on
    // `window`.
    overlayRoot.style.pointerEvents = cursor === '' ? '' : 'none'
  }

  /** Everything a drag put in place, undone — shared by the release and the
   * cancel, which differ only in what they do AFTER this. */
  const teardownDrag = (): void => {
    dragIds = []
    dragMask = null
    dragGhost.hide()
    stopEdgePan()
    cancelSpring()
    chartHost.setDrag(-1)
    setDropTarget(-1, 'into', true)
    host.classList.remove('klad-dragging')
    host.classList.remove('klad-drag-refused')
    setDragCursor('')
    scheduleFrame()
  }

  const setDropTarget = (index: number, mode: DropMode, valid: boolean): void => {
    if (index === dropTargetIndex && mode === dropTargetMode && valid === dropTargetValid) return
    dropTargetIndex = index
    dropTargetMode = mode
    dropTargetValid = valid
    chartHost.setDropTarget(index, mode, valid)
    // The pointer is the only thing the viewer is actually looking at during a
    // drag, so it carries the answer to "will this be taken?". The drop
    // preview says it too, but it is under the ghost and under the cursor,
    // which is exactly where a pointer is not.
    const refused = index !== -1 && !valid
    host.classList.toggle('klad-drag-refused', refused)
    // Only while a drag is actually running: `setDropTarget(-1, ...)` is also
    // how a drag is torn down, and that call must not paint a cursor back on.
    if (dragIds.length > 0) setDragCursor(refused ? 'no-drop' : 'grabbing')
    scheduleFrame()
  }

  // --- spring-loaded folders ---------------------------------------------
  //
  // A closed branch is a wall: its children are not on screen, so there is no
  // way to aim at one. Every file manager answers this the same way — hold
  // over a closed folder and it opens — and the answer is the same here for
  // the same reason. The alternative is to open every branch you might want
  // BEFORE picking anything up, which is a plan the viewer has to make in
  // advance of knowing where they are going.

  /** How long the pointer has to rest on a closed branch before it opens. Long
   * enough that crossing one on the way somewhere else does not trip it,
   * short enough not to feel like waiting. */
  const SPRING_DELAY_MS = 550
  let springTimer: ReturnType<typeof setTimeout> | null = null
  /** The node the timer is counting down for, by SOURCE index. */
  let springIndex = -1
  /**
   * Everything this drag sprang open, by id, oldest first.
   *
   * Kept so they can be closed again at the end. A drag that wanders across
   * six folders on its way to the seventh should not leave all seven standing
   * open — the viewer opened none of them on purpose. What survives is the
   * chain the drop actually landed in, which they did mean, and which is the
   * one place they now want to be looking.
   */
  let sprungOpen: string[] = []

  const cancelSpring = (): void => {
    if (springTimer !== null) clearTimeout(springTimer)
    springTimer = null
    springIndex = -1
  }

  /** Arms, re-arms or disarms the timer for whatever the pointer is now over.
   * Re-hovering the SAME node does not restart the countdown, or a pointer
   * jittering by a pixel would hold it off forever. */
  const armSpring = (index: number): void => {
    if (index === springIndex) return
    cancelSpring()
    if (index === -1 || dragMask === null) return
    // Already open, childless, or part of what is being carried: nothing to
    // reveal, and in the last case nothing that could legally be dropped in.
    if (open[index] === 1 || !canHaveChildren(index) || dragMask[index] === 1) return
    springIndex = index
    springTimer = setTimeout(() => {
      springTimer = null
      const target = springIndex
      springIndex = -1
      // The drag may have ended, or the data been replaced, in the meantime.
      if (dragMask === null || target === -1 || target >= tree.count) return
      if (open[target] === 1) return
      sprungOpen.push(tree.indexToId[target]!)
      // `requestOpen`, not `setOpenFlag`: a branch nobody has opened yet is
      // exactly the branch a drag cannot reach, which is what spring-loading
      // is for. The fetch lands mid-gesture and the drop preview re-resolves
      // against the children it brought in.
      requestOpen(target)
    }, SPRING_DELAY_MS)
  }

  /** Closes what this drag sprang open, keeping `keepUnder` and its ancestors
   * — the branch the drop landed in. `null` keeps nothing, which is the
   * cancelled case: the viewer asked for none of this. */
  const collapseSprung = (keepUnder: number): void => {
    const keep = new Set<string>()
    for (let i = keepUnder; i !== -1; i = tree.parent[i]!) {
      keep.add(tree.indexToId[i]!)
    }
    // Deepest first, so a parent closing does not have to reason about
    // children whose flags are still being changed underneath it.
    for (const id of [...sprungOpen].reverse()) {
      if (keep.has(id)) continue
      const index = tree.idToIndex.get(id)
      if (index === undefined || open[index] !== 1) continue
      setOpenFlag(index, false)
    }
    sprungOpen = []
  }

  /**
   * Hit-test on THIS thread, synchronously.
   *
   * `chartHost.hitTest` returns a promise — in worker mode it may genuinely
   * have to ask — and a drag cannot await one: the answer would arrive a frame
   * or two after the pointer has moved on, so the preview would trail the
   * cursor and, worse, `onDragStart` would have to decide whether to claim the
   * gesture before it knew if there was a node under it. Every input this
   * needs is already mirrored on the main thread for the overlay, so it
   * answers now.
   */
  const hitTestLocal = (worldX: number, worldY: number): number => {
    for (let i = 0; i < visibleToSource.length; i++) {
      const o = i * 4
      const x = boxes[o]!
      const y = boxes[o + 1]!
      if (worldX < x || worldY < y) continue
      if (worldX > x + boxes[o + 2]! || worldY > y + boxes[o + 3]!) continue
      return visibleToSource[i]!
    }
    return -1
  }

  /**
   * Reports a completed drop, and applies it unless the handler refuses.
   *
   * The event fires BEFORE anything moves, which is what makes refusing it
   * meaningful — a handler that had to undo a move it did not want would have
   * to know how to undo it, and would flash the wrong tree on the way.
   */
  const emitDrop = (ids: string[], target: number, mode: DropMode): void => {
    const pruned = sourceToPruned.get(target)
    if (pruned === undefined) return
    const visible = pruneToVisible(tree, open, isolatedIndex, filterKeep)
    const position = dropPosition(visible.tree, pruned, mode)
    const parentSource = position.parent === -1 ? -1 : visible.toSource[position.parent]!
    // In tree order, so a handler applying this to its own array does not have
    // to work the ordering out. `tree.order` is preorder, which is the order a
    // viewer sees them in.
    const ordered = Array.from(tree.order)
      .map((index) => tree.indexToId[index]!)
      .filter((id) => ids.includes(id))

    let refused = false
    emit('nodeDrop', {
      ids: ordered,
      items: ordered.map((id) => itemById.get(id) ?? { id }),
      parentId: parentSource === -1 ? null : tree.indexToId[parentSource]!,
      index: position.index,
      mode,
      preventDefault: () => {
        refused = true
      },
    })
    if (refused) return
    // Pinned to the node that was dropped ONTO, not the one that moved — see
    // `applyReparent`.
    applyReparent(
      ordered,
      parentSource === -1 ? null : tree.indexToId[parentSource]!,
      position.index,
      target,
    )
  }

  /**
   * Moves `ids` under `parentId` at `index`, and relayouts.
   *
   * Builds a NEW array rather than mutating the one the caller handed in:
   * `data` is their object, and a chart quietly rewriting `parentId` on rows
   * it was given is the kind of side effect that shows up as a bug somewhere
   * else entirely. The chart's own copy moves; the caller reconciles their
   * store from `nodeDrop`, which is what that event is for.
   *
   * Open state survives, keyed by id — unlike `update()`, which resets it.
   * Dropping a node is not a reason to fold up the branch you dropped it into,
   * and doing so would hide the result of the very action just taken.
   */
  const applyReparent = (ids: string[], parentId: string | null, index: number, pinSource = -1): void => {
    const moving = new Set(ids)
    // Where the DROP TARGET is on screen right now. Pinned across the
    // relayout below, so the place the viewer just dropped onto stays under
    // their cursor while everything reflows around it. Anchoring the dropped
    // node instead would drag the camera along with it — which is the one
    // thing that IS supposed to move.
    const pinBox = pinSource === -1 ? null : boxOfSource(pinSource)
    const pinId: string | undefined = pinSource === -1 ? undefined : tree.indexToId[pinSource]
    const pinScreen =
      pinBox === null
        ? null
        : worldToScreen(camera, pinBox.x + pinBox.w / 2, pinBox.y + pinBox.h / 2)
    const openById = new Map<string, boolean>()
    for (let i = 0; i < tree.count; i++) openById.set(tree.indexToId[i]!, open[i] === 1)

    // Everything, loaded children included — a reparent rebuilds the array
    // the chart lays out, and one built from `currentOptions.data` alone would
    // throw away every branch that had been fetched.
    const source = treeSource()
    const moved: NodeData[] = []
    const rest: NodeData[] = []
    for (const item of source) {
      if (moving.has(String(item.id))) moved.push({ ...item, parentId })
      else rest.push(item)
    }
    // `index` counts among the target parent's children BEFORE the moving
    // nodes were taken out, so splicing into the remaining siblings needs it
    // adjusted by however many of them sat ahead of the insertion point —
    // otherwise moving a node down within its own parent lands it one slot
    // short every time.
    const siblingsBefore = source.filter(
      (item) => (item.parentId ?? null) === parentId && !moving.has(String(item.id)),
    )
    const anchor = siblingsBefore[Math.min(index, siblingsBefore.length) - 1]
    const insertAt =
      anchor === undefined ? 0 : rest.findIndex((item) => item.id === anchor.id) + 1
    rest.splice(insertAt, 0, ...moved)

    currentOptions = { ...currentOptions, data: rest }
    // The two stores collapse into one here. `rest` already contains what had
    // been loaded, so leaving it in the map as well would duplicate every
    // fetched node on the next rebuild. From this point they are ordinary
    // data, which they are: the host's array was replaced a line ago either
    // way, and the nodes stay loaded — they just have one home instead of two.
    loadedChildren.clear()
    const previous = tree
    tree = normalize(rest)

    // OLD source index -> NEW. A source index only means anything within one
    // `normalize`, and the array was just rebuilt, so without this the
    // transition would tween every node from wherever its index used to point
    // — the whole chart shuffling rather than one node moving.
    const remap = new Int32Array(previous.count).fill(-1)
    for (let i = 0; i < previous.count; i++) {
      remap[i] = tree.idToIndex.get(previous.indexToId[i]!) ?? -1
    }
    stats = computeSubtreeStats(tree)
    rebuildItemIndex()
    const next = new Uint8Array(tree.count)
    for (let i = 0; i < tree.count; i++) {
      next[i] = (openById.get(tree.indexToId[i]!) ?? true) ? 1 : 0
    }
    open = next
    // The node just landed somewhere; showing it closed would hide the result
    // of the action. Opening its new parent is the one open-state change a
    // drop is entitled to make.
    if (parentId !== null) {
      const parentIndex = tree.idToIndex.get(parentId)
      if (parentIndex !== undefined) open[parentIndex] = 1
    }
    pendingAnchor = null
    cameraAnchor = null
    // The nodes are the same ones; only their positions changed. That is
    // exactly what the layout transition is for, and it has to be asked for —
    // the engine cannot tell a reparent from a fresh dataset by looking at it.
    chartHost.animateNextLayout(remap)
    applyData()
    if (pinScreen !== null && pinId !== undefined) pendingPin = { id: pinId, screen: pinScreen }
    a11yDirty = true
    scheduleFrame()
  }

  // --- children on demand -------------------------------------------------
  //
  // The chart holds what `loadChildren` returns; the host's `data` array stays
  // as it was handed over. That is the whole of the ownership story, and it is
  // what keeps this from leaking into `refresh()` and `update()`: the loaded
  // children live in `loadedChildren` below and are folded back in every time
  // the tree is rebuilt from `data`.

  /** Parent id -> the children a loader returned for it. Insertion-ordered,
   * which is the order they are laid out in. */
  const loadedChildren = new Map<string, NodeData[]>()
  /** Loads in flight, by node id. Both a guard against firing a second request
   * for a node already waiting on one, and what the loading mark reads. */
  const loadingIds = new Set<string>()

  /** Children this node has in the tree right now — loaded or given. */
  const childCountOf = (index: number): number =>
    tree.childStart[index + 1]! - tree.childStart[index]!

  /**
   * True for a node the host says has children that have not been fetched.
   *
   * Deliberately requires an EMPTY node: `mayHaveChildren` is answering "is
   * there more here", and once children are in the tree the answer is visibly
   * yes. A host whose count says "5" for a node that already has 3 is telling
   * us something we cannot act on — there is no way to ask for "the other
   * two" — so the honest reading is that this node is done.
   */
  const isUnloaded = (index: number): boolean => {
    if (currentOptions.loadChildren === undefined) return false
    if (childCountOf(index) > 0) return false
    const mayHave = currentOptions.mayHaveChildren
    if (mayHave === undefined) return false
    if (loadedChildren.has(tree.indexToId[index]!)) return false
    return mayHave(itemFor(index))
  }

  /**
   * Whether a node should offer a way in — the question a chevron, a toggle
   * button and the keyboard's right-arrow all ask. A node waiting to be
   * fetched answers yes, which is the point: something has to be clickable or
   * the children can never be asked for.
   */
  const canHaveChildren = (index: number): boolean =>
    childCountOf(index) > 0 || isUnloaded(index)

  /** The SOURCE-indexed mask the engine needs to mark unloaded nodes as having
   * more inside — see `ChartEngine.setData`. `null` when nothing is lazy,
   * which is the common case and puts nothing on the wire. */
  const unloadedMask = (): Uint8Array | null => {
    if (currentOptions.loadChildren === undefined) return null
    let any = false
    const mask = new Uint8Array(tree.count)
    for (let i = 0; i < tree.count; i++) {
      if (isUnloaded(i)) {
        mask[i] = 1
        any = true
      }
    }
    return any ? mask : null
  }

  /**
   * Fetches a node's children and folds them in, once.
   *
   * The node is NOT opened first. Opening an empty branch and then filling it
   * would flash a node that says "nothing here" for the length of a network
   * round trip, which is the one thing that is not true. It opens when the
   * children arrive, in the same relayout that brings them.
   */
  const loadChildrenOf = async (index: number): Promise<void> => {
    const load = currentOptions.loadChildren
    if (load === undefined) return
    const id = tree.indexToId[index]!
    if (loadingIds.has(id) || loadedChildren.has(id)) return
    // Where the node is on screen right now. Held across the relayout below,
    // exactly as a drop holds its target: the viewer is looking at the node
    // they just clicked, and the tree growing underneath it is no reason for
    // it to move.
    const box = boxOfSource(index)
    const screen = box === null ? null : worldToScreen(camera, box.x + box.w / 2, box.y + box.h / 2)
    const item = itemFor(index)

    loadingIds.add(id)
    // Repaint: the node is marked as loading from here until it is not.
    a11yDirty = true
    scheduleFrame()
    try {
      const items = await load(item)
      // The chart may have been torn down, or the whole dataset replaced,
      // while this was in flight. Either way the answer is about a tree that
      // no longer exists.
      if (destroyed || tree.idToIndex.get(id) === undefined) return
      loadedChildren.set(id, [...items])
      rebuildFromLoad(id, screen)
      emit('childrenLoaded', { id, item, items })
    } catch (error) {
      if (destroyed) return
      // Left unloaded on purpose, so clicking again retries. Nothing retries
      // on its own: a chart that re-fired a failing request would do it for
      // every node the viewer touches, and the host is the only one who knows
      // whether the failure was worth repeating.
      emit('warning', {
        code: 'load-failed',
        detail: error instanceof Error ? error.message : String(error),
        ids: [id],
      })
    } finally {
      loadingIds.delete(id)
      a11yDirty = true
      scheduleFrame()
    }
  }

  /**
   * Rebuilds the tree around children that have just arrived, opening the node
   * they belong to and settling rather than jumping.
   *
   * The same recipe as `applyReparent`: open state carried across by id, an
   * old-to-new index remap so the transition tweens the nodes that already
   * existed instead of shuffling the whole chart, and a screen-space pin on
   * the one node the viewer is looking at.
   */
  const rebuildFromLoad = (id: string, screen: { x: number; y: number } | null): void => {
    const openById = new Map<string, boolean>()
    for (let i = 0; i < tree.count; i++) openById.set(tree.indexToId[i]!, open[i] === 1)

    const previous = tree
    tree = normalize(treeSource())
    const remap = new Int32Array(previous.count).fill(-1)
    for (let i = 0; i < previous.count; i++) {
      remap[i] = tree.idToIndex.get(previous.indexToId[i]!) ?? -1
    }
    stats = computeSubtreeStats(tree)
    rebuildItemIndex()
    const next = new Uint8Array(tree.count)
    for (let i = 0; i < tree.count; i++) {
      // Nodes that already existed keep what they were; the ones that just
      // arrived take `collapsedByDefault`, the same rule they would have had
      // if they had been in `data` all along.
      const nodeId = tree.indexToId[i]!
      const was = openById.get(nodeId)
      next[i] = (was ?? opensByDefault(i)) ? 1 : 0
    }
    open = next
    // The node the viewer clicked. Opening it is the whole point of the fetch,
    // and it is the one open-state change a load is entitled to make.
    const index = tree.idToIndex.get(id)
    if (index !== undefined) open[index] = 1
    pendingAnchor = null
    cameraAnchor = null
    chartHost.animateNextLayout(remap)
    applyData(false)
    if (screen !== null) pendingPin = { id, screen }
    a11yDirty = true
    emit('toggle', { id, open: true })
    scheduleFrame()
  }

  /**
   * Opens a node, fetching its children first if they have not arrived.
   *
   * Every single-node open goes through here rather than straight to
   * `setOpenFlag` — a click, the keyboard, `expand(id)`, a drag resting on a
   * folder. That is deliberate: an unloaded node is only reachable through one
   * of those, so a path that skipped this would open a branch that stays
   * permanently empty with no way to ever ask for its contents.
   */
  const requestOpen = (index: number): void => {
    if (isUnloaded(index)) {
      void loadChildrenOf(index)
      return
    }
    setOpenFlag(index, true)
  }

  /**
   * Builds the keep mask from `filterQuery` and hands it to the engine.
   * Returns the ids that MATCHED — not the ids kept, which also include the
   * ancestors that lead to them and which nobody asked about.
   *
   * Re-run rather than cached whenever the tree is rebuilt: a source index
   * means nothing across a `normalize`, so a mask from the previous tree would
   * keep an arbitrary set of nodes.
   */
  const applyFilter = (): string[] => {
    if (filterQuery === null) {
      filterKeep = null
      chartHost.setFilter(null)
      return []
    }
    const query = filterQuery
    const predicate =
      typeof query === 'function'
        ? query
        : (item: NodeData) => labelOf(item).toLowerCase().includes(query.toLowerCase())

    const keep = new Uint8Array(tree.count)
    const matched: string[] = []
    for (let i = 0; i < tree.count; i++) {
      if (!predicate(itemFor(i))) continue
      matched.push(tree.indexToId[i]!)
      // The match, and every ancestor that leads to it. Walking up and
      // stopping at the first node already marked keeps this O(nodes) overall
      // rather than O(nodes x depth): an ancestor is only ever climbed once,
      // by whichever match reaches it first.
      for (let a = i; a !== -1 && keep[a] !== 1; a = tree.parent[a]!) keep[a] = 1
    }
    filterKeep = keep
    chartHost.setFilter(keep)
    return matched
  }

  /** `NodeStats` for a node by INDEX — six array reads, no walking. See
   * `NodeStats` and core's `computeSubtreeStats`. */
  const statsOf = (index: number): NodeStats => ({
    directChildren: stats.directChildren[index]!,
    descendants: stats.descendants[index]!,
    depth: tree.depth[index]!,
    height: stats.height[index]!,
    lft: stats.lft[index]!,
    rgt: stats.rgt[index]!,
  })

  const boxOfSource = (source: number) => {
    const i = sourceToPruned.get(source)
    if (i === undefined) return null
    return {
      x: boxes[i * 4]!,
      y: boxes[i * 4 + 1]!,
      w: boxes[i * 4 + 2]!,
      h: boxes[i * 4 + 3]!,
    }
  }

  /**
   * `boxOfSource`, but returns wherever a node visually IS on the canvas
   * THIS FRAME rather than where it will settle — the interpolated box, for
   * as long as the engine's own layout transition is moving it, falling
   * back to `boxOfSource`'s ordinary final-layout box otherwise (identical
   * to it outside a transition, and for any node outside the bounded
   * drawn/visible set `renderBoxBySource` covers — see its docblock).
   *
   * This is what the DOM overlay positions cards from (see `scheduleFrame`'s
   * `overlay.update` call) and what `setOpenFlag` reads a node's CURRENT
   * on-screen position from when arming a new camera anchor — both need
   * "what's actually drawn right now", not "the settled target". The one
   * deliberate exception is the anchor's OWN `toCentre` (the settled target
   * itself, resolved via `boxOfSource` directly in `scheduleFrame`'s
   * `pendingAnchor` branch) — that one must stay on the final layout
   * regardless of what's mid-flight, or the anchor would be chasing a
   * moving target instead of holding a fixed one.
   */
  const interpolatedBoxOfSource = (source: number) => {
    const interpolated = renderBoxBySource?.get(source)
    return interpolated ?? boxOfSource(source)
  }

  /** This frame's reveal alpha for a node, `1` (fully opaque) for anything
   * not currently fading — see `renderAlphaBySource`. */
  const alphaOfSource = (source: number): number => renderAlphaBySource?.get(source) ?? 1

  /**
   * Rebuilds `renderBoxBySource` from whatever `chartHost.lastDrawnBoxes` says
   * right now, keyed against the CURRENT `drawn` (the two are always aligned
   * 1:1 — see `ChartHost.lastDrawnBoxes`'s docblock). Called once per
   * `render()` this layer actually awaits, so a caller reading
   * `interpolatedBoxOfSource` between frames (e.g. `setOpenFlag`, triggered
   * by a click) always sees the most recently drawn frame's geometry.
   */
  const refreshRenderBoxBySource = (): void => {
    // Independent of `lastDrawnBoxes`: it is `null` on strictly more frames
    // (only an expand with something actually fading on screen produces one),
    // so this is resolved on its own rather than inside the early return
    // below.
    const lastDrawnAlpha = chartHost.lastDrawnAlpha
    if (lastDrawnAlpha === null) renderAlphaBySource = null
    else {
      const alphas = new Map<number, number>()
      for (let i = 0; i < drawn.length; i++) alphas.set(drawn[i]!, lastDrawnAlpha[i]!)
      renderAlphaBySource = alphas
    }

    const lastDrawnBoxes = chartHost.lastDrawnBoxes
    if (lastDrawnBoxes === null) {
      renderBoxBySource = null
      return
    }
    const map = new Map<number, { x: number; y: number; w: number; h: number }>()
    for (let i = 0; i < drawn.length; i++) {
      const o = i * 4
      map.set(drawn[i]!, {
        x: lastDrawnBoxes[o]!,
        y: lastDrawnBoxes[o + 1]!,
        w: lastDrawnBoxes[o + 2]!,
        h: lastDrawnBoxes[o + 3]!,
      })
    }
    renderBoxBySource = map
  }

  /**
   * Recreates (or tears down) the minimap widget to match the current
   * `minimap` option. Called on construction and on every `update()`, since
   * either can change the config. Cheap to call even when nothing changed:
   * the widget itself is only a couple of small DOM nodes.
   */
  const setupMinimap = (): void => {
    minimap?.destroy()
    minimap = null
    const opt = currentOptions.minimap
    if (opt === undefined || opt === false) return
    minimap = createMinimap(host, opt === true ? {} : opt, {
      onPan(worldX, worldY) {
        const rect = host.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        cancelCameraAnimation()
        setCameraInstant(
          centreOn(
            camera,
            { minX: worldX, minY: worldY, maxX: worldX, maxY: worldY },
            { width: rect.width, height: rect.height },
          ),
        )
      },
    })
    // Force the next frame to paint it, even if `boxes`' reference happens to
    // be unchanged since the last time it was read (e.g. the minimap was just
    // switched on with no relayout in between).
    lastMinimapBoxes = null
  }

  /**
   * Builds a fresh `ExportData` snapshot for `toSVG`/`toBlob`/`print`, by
   * independently re-running the same pure pipeline `ChartEngine.getExportData()`
   * uses internally (`pruneToVisible` -> `layout` -> `applyOrientation`) against
   * the CURRENT `tree`/`open`/sizing state, rather than reaching into the
   * engine directly.
   *
   * This is a deliberate workaround, not a shortcut: `ChartHost` (see
   * `@klad/engine/host`) does not expose `getExportData()`, and in
   * worker mode the live `ChartEngine` lives inside the worker and is not
   * reachable from here at all — only `boxes`/`bounds`/`visibleToSource` are
   * mirrored back across the protocol, not the pruned `parent`/`labels`
   * arrays export needs. Recomputing here, from data this layer already
   * holds, works identically on both the worker and main-thread paths and is
   * always fresh (never a stale mirrored buffer from before the latest
   * `setOpen`/`update`) — see this function's callers' docblocks for why that
   * freshness matters. The cost is one extra synchronous layout pass at
   * export time, which is fine: export is a deliberate, infrequent user
   * action, not a per-frame path.
   */
  /**
   * 1 per visible node with children that are all off screen — mirrors the
   * engine's own `hasHidden`; see `Frame.hasHidden`. `null` when nothing is
   * hiding anything.
   */
  const hiddenMarks = (
    visible: ReturnType<typeof pruneToVisible>,
    sectors: Float64Array | null,
  ): Uint8Array | null => {
    const count = visible.tree.count
    const marks = new Uint8Array(count)
    let any = false
    for (let i = 0; i < count; i++) {
      const src = visible.toSource[i]!
      if (tree.childStart[src]! === tree.childStart[src + 1]!) continue
      let shown = false
      for (let j = visible.tree.childStart[i]!; j < visible.tree.childStart[i + 1]!; j++) {
        const child = visible.tree.childIndex[j]!
        if (sectors === null) {
          shown = true
          break
        }
        const o = child * 6
        if (sectors[o + 3]! - sectors[o + 2]! > 0 && sectors[o + 5]! - sectors[o + 4]! > 0) {
          shown = true
          break
        }
      }
      if (!shown) {
        marks[i] = 1
        any = true
      }
    }
    return any ? marks : null
  }

  const buildExportData = (): ExportData => {
    // Isolation included: an export is a picture of the chart, and the chart
    // is currently one branch. Leaving it out would put the whole org in a PNG
    // taken while the screen showed a department.
    const visible = pruneToVisible(tree, open, isolatedIndex, filterKeep)
    const n = visible.tree.count
    const layoutName = currentOptions.layout ?? 'tidy'
    const orientation = currentOptions.orientation ?? 'tb'
    const rtl = currentOptions.rtl ?? false
    // Every one of these mirrors a decision `engine.ts`'s `relayout` makes. It
    // has to: an export that laid the tree out by different rules from the one
    // on screen would be a picture of a chart nobody is looking at.
    const tidyLayout = layoutName === 'tidy'
    const horizontal = tidyLayout && (orientation === 'lr' || orientation === 'rl')

    const sizes: Float64Array = new Float64Array(n * 2)
    const labels: string[] = Array.from({ length: n })
    for (let i = 0; i < n; i++) {
      const src = visible.toSource[i]!
      const item = itemFor(src)
      const size = sizeOf(item)
      // Transposed for a horizontal tidy tree, exactly as the engine does —
      // the layout always works in a top-down space and `applyOrientation`
      // swaps back. Without this an `lr` export drew every card rotated.
      sizes[i * 2] = horizontal ? size.h : size.w
      sizes[i * 2 + 1] = horizontal ? size.w : size.h
      labels[i] = labelOf(item)
    }
    const spacingX = currentOptions.spacing?.x ?? 16
    const spacingY = currentOptions.spacing?.y ?? 48
    const centre = centreIndex()
    const result = resolveLayout(layoutName)(visible.tree, sizes, {
      spacingX: horizontal ? spacingY : spacingX,
      spacingY: horizontal ? spacingX : spacingY,
      step: currentOptions.layoutStep,
      rowGap: currentOptions.rowGap,
      focus: centre === -1 ? -1 : (visible.fromSource[centre] ?? -1),
      maxRings: currentOptions.maxRings,
    })
    const exportBounds = isPolarLayout(layoutName)
      ? result.bounds
      : applyOrientation(result.boxes, result.bounds, tidyLayout ? orientation : 'tb', rtl)

    let branchOf: Int32Array | null = null
    let branchDepth: Int32Array | null = null
    if (currentOptions.colourBranches ?? layoutName === 'sunburst') {
      const of = new Int32Array(n)
      const bd = new Int32Array(n)
      for (let k = 0; k < n; k++) {
        const i = visible.tree.order[k]!
        const p = visible.tree.parent[i]!
        if (p === -1) {
          of[i] = -1
          bd[i] = 0
        } else if (of[p] === -1) {
          of[i] = i
          bd[i] = 0
        } else {
          of[i] = of[p]!
          bd[i] = bd[p]! + 1
        }
      }
      branchOf = of
      branchDepth = bd
    }

    return {
      boxes: result.boxes,
      parent: visible.tree.parent,
      labels,
      bounds: exportBounds,
      horizontal,
      rtl,
      edgeStyle: edgeStyleForLayout(layoutName),
      sectors: result.sectors ?? null,
      angles: result.angles ?? null,
      labelSpace: result.labelSpace ?? 0,
      // Recomputed here rather than mirrored from the engine, for the same
      // reason the rest of `buildExportData` is: in worker mode the live
      // engine is unreachable from this thread. A node counts as hiding
      // something when it has children in the source tree and none of them
      // are drawn — either pruned away, or (on a wheel) parked at zero extent
      // past the last ring.
      hasHidden: hiddenMarks(visible, result.sectors ?? null),
      branchOf,
      branchDepth,
    }
  }

  // `overlay` and `a11y` both call into `api`, so they are created after it —
  // see below the `api` declaration.
  let overlay: ReturnType<typeof createOverlay> | null = null
  let a11y: A11yTree | null = null

  /**
   * Where the chart opens.
   *
   * Not a fit. An org chart is far wider than it is tall — a few hundred nodes is
   * already tens of thousands of pixels across — so fitting the whole thing shrinks
   * every card to an unreadable sliver, which reads as a broken chart rather than a
   * zoomed-out one. Open at a readable scale anchored on the first root instead, and
   * leave "show me everything" to an explicit `fit()`. Charts small enough to fit
   * whole still do, because the scale is capped at the fit scale rather than exceeding it.
   */
  const openingCamera = (): Camera => {
    const rect = host.getBoundingClientRect()
    const size = { width: rect.width, height: rect.height }
    const fitted = fitCamera(bounds, size, FIT_PADDING, limits)
    // A wheel opens FITTED, not at 1:1 with its root pinned to the top. The
    // rule below is about a tree that grows downward off the bottom of the
    // screen — "start at the top, at a readable size, and let them scroll" —
    // and a radial chart or a sunburst has no such direction: it is a single
    // round object read from the middle outward, and showing the top-left
    // quarter of one at 1:1 is showing a viewer an arc they cannot place.
    // Its own bounds are already a square with the centre in the middle, so
    // the fit is the correct opening view by construction.
    if (isPolarLayout(currentOptions.layout)) return fitted
    // 1:1. Not the fit scale — on a wide chart that is a tiny number, which is the
    // whole problem this avoids.
    const k = 1

    const rootIndex = tree.roots[0]
    const rootBox = rootIndex === undefined ? null : boxOfSource(rootIndex)
    if (rootBox === null) return fitted

    // A file list opens at its top-LEFT corner, not with its root centred.
    // Centring is right for a tiered tree, whose children fan out to both
    // sides of the root; a file list only ever grows to the right, so
    // centring its one-row-wide root leaves the whole list sitting in the
    // right-hand half of the screen with an empty left margin as wide as the
    // deepest indent it will ever reach. (RTL mirrors, so it opens at the
    // top-right instead.)
    if (currentOptions.layout === 'file') {
      return {
        x: currentOptions.rtl === true ? size.width - FIT_PADDING - (rootBox.x + rootBox.w) * k : FIT_PADDING - rootBox.x * k,
        y: FIT_PADDING - rootBox.y * k,
        k,
      }
    }

    return {
      x: size.width / 2 - (rootBox.x + rootBox.w / 2) * k,
      // Sit the root near the top, not the middle: everything of interest hangs below it.
      y: FIT_PADDING - rootBox.y * k,
      k,
    }
  }

  const getState = (): ChartState => {
    const rootBox = tree.roots.length > 0 ? boxOfSource(tree.roots[0]!) : null
    const centre =
      rootBox === null
        ? { x: 0, y: 0 }
        : {
            x: (rootBox.x + rootBox.w / 2) * camera.k + camera.x,
            y: (rootBox.y + rootBox.h / 2) * camera.k + camera.y,
          }
    return {
      nodeCount: tree.count,
      visibleCount: visibleToSource.length,
      camera,
      bounds,
      rootScreenCentre: centre,
      highlighted: highlightedIds,
      isolated: isolatedIndex === -1 ? null : (tree.indexToId[isolatedIndex] ?? null),
      selected: [...selectedIds],
    }
  }

  const publish = (): void => {
    const state = getState()
    for (const listener of stateListeners) listener(state)
  }

  /**
   * Set by anything that mutates `open`. The accessibility mirror is rebuilt from
   * scratch, which measures ~16ms at 10k nodes, so it must not run on a camera move —
   * but it also must not be left to each call site to remember. One flag refreshed in
   * one place is what stops a new bulk operation from silently shipping a mirror that
   * lies about which nodes are expanded.
   */
  let a11yDirty = false

  /**
   * The chart cannot be fitted at construction time: `bounds` is empty until the
   * first render triggers a layout, so fitting eagerly produces an arbitrary camera
   * and the first paint shows the chart adrift. Defer it to the first frame that
   * reports real bounds, then re-render once so the user never sees the wrong view.
   */
  let needsInitialFit = true

  /** Screen-space centre of `box`, in this element's own coordinate space —
   * `camera.x/y` units, not CSS pixels of the page. */
  const boxCentre = (box: { x: number; y: number; w: number; h: number }): { x: number; y: number } => ({
    x: box.x + box.w / 2,
    y: box.y + box.h / 2,
  })

  const lerpPoint = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    t: number,
  ): { x: number; y: number } => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  })

  /**
   * Keeps a single-node `expand`/`collapse`'s toggled node pinned to a FIXED
   * screen position for as long as the engine's layout transition is moving
   * things around it — the camera no longer pans TO the node (see the
   * removed `autoPanToRegion`); instead the node is the fixed point the rest
   * of the layout grows out of or collapses back into, and this is what
   * keeps it fixed, frame by frame, by adjusting the camera instead.
   *
   * `fromCentre`/`toCentre` are the node's own world-space centre a moment
   * before the toggle and once the toggle's relayout has run — the node
   * always survives its own toggle (only its DESCENDANTS' visibility
   * changes), so it always has both. Interpolating between them with
   * `transitionAnchorProgress` (exported by core for exactly this) replays
   * the SAME curve the engine itself is drawing that node's own box with
   * internally, without this layer ever reaching into the engine's
   * transition state — which also means it works unchanged whether the
   * engine is rendering in-process or in a Web Worker.
   */
  interface CameraAnchor {
    source: number
    screenX: number
    screenY: number
    fromCentre: { x: number; y: number }
    toCentre: { x: number; y: number }
    /** This toggle's direction (expand/collapse) — `transitionAnchorProgress`
     * needs it to know which of the two staged phases the node's OWN
     * reposition tween falls into. */
    opening: boolean
    /** This layer's own `requestAnimationFrame` clock, at the instant the
     * relayout this toggle triggered actually ran — the same instant the
     * engine used as its OWN transition's start (see `setOpenFlag` and
     * `scheduleFrame` for how the two stay in sync without the engine
     * exposing that timestamp directly). */
    startedAt: number
  }
  let cameraAnchor: CameraAnchor | null = null

  /**
   * Set by a single-node `expand`/`collapse` (see `setOpenFlag`), captured
   * BEFORE the toggle is even sent to the engine: the node's current on-screen
   * position (the pin point) and its current world-space centre. Promoted
   * into `cameraAnchor` on the next frame that reports fresh boxes, because
   * the node's POST-toggle centre cannot be known until the toggle's relayout
   * has actually run. Cleared by `update()` since a data reload invalidates
   * the index it names.
   */
  let pendingAnchor: {
    source: number
    screenX: number
    screenY: number
    fromCentre: { x: number; y: number }
    opening: boolean
  } | null = null

  /**
   * Set by `expandAll`/`collapseAll`: the whole chart changed shape, so the
   * sensible response is a full `fit()` rather than trying to pin any single
   * node — there is no one "the toggled node" for a bulk operation. Takes
   * priority over `pendingAnchor`/`cameraAnchor` if somehow both end up set
   * before the next frame.
   */
  let pendingFullFit = false

  /**
   * Hold one node's SCREEN position fixed across the next relayout.
   *
   * Set by a drop: the destination is where the viewer is looking, and a chart
   * that jumped after they let go makes them find their place again for no
   * reason. Keyed by id rather than index because the relayout it survives is
   * exactly the one that renumbers the indices.
   *
   * Applied once, against the settled layout, rather than tracked per frame
   * like `cameraAnchor`: the node it pins barely moves, so pinning where it
   * ENDS UP is indistinguishable from pinning it throughout, and needs none of
   * the phase-matching the toggle anchor does.
   */
  let pendingPin: { id: string; screen: { x: number; y: number } } | null = null

  /**
   * The ids the caller last passed to `highlight`, so `refresh` can restore
   * them — `setData` drops the engine's highlight, since it holds source
   * indices that a real data swap would invalidate.
   */
  let highlightedIds: string[] | null = null
  /** Source index the chart is re-rooted at, or -1 — see `api.isolate`. */
  let isolatedIndex = -1
  /**
   * The filter, as a SOURCE-indexed keep mask — 1 for a node on screen, 0 for
   * one the filter removed — or `null` when nothing is filtering.
   *
   * Held here rather than as a query string because it has to be re-derived
   * whenever the tree is rebuilt (a drop, a lazy load, `refresh`), and because
   * three other things need the same answer: the screen-reader mirror, the
   * export, and drop resolution each work out visibility for themselves.
   */
  let filterKeep: Uint8Array | null = null
  /** What the filter was asked, kept so a rebuild can ask it again. */
  let filterQuery: string | ((item: NodeData) => boolean) | null = null
  /** Ids of the selected nodes, in the order they were given. */
  let selectedIds: string[] = []
  /** Set when the next relayout is a different TREE — see the minimap call. */
  let minimapNeedsRefit = false

  /**
   * Set by `focus()`, consumed by the first frame that has the layout its
   * `expandTo` produced — see `KladApi.focus` for why the move cannot
   * happen synchronously. Holds a SOURCE index, valid until the data is
   * replaced (`update()` clears it alongside the other pending camera work).
   */
  let pendingFocus: { source: number; ring: boolean } | null = null

  const refreshA11y = (): void => {
    if (!a11yDirty) return
    a11yDirty = false
    a11y?.update(tree, open, (i) => labelOf(itemFor(i)), isolatedIndex, unloadedMask(), filterKeep)
  }

  const scheduleFrame = (): void => {
    if (frameRequested || destroyed) return
    frameRequested = true
    requestAnimationFrame(async (now) => {
      frameRequested = false
      if (destroyed) return
      // An ALREADY-ACTIVE anchor advances BEFORE the render it belongs to,
      // not after it. Both the engine's node tween and this anchor are pure
      // functions of `now`, so solving the camera for `now` first is what
      // makes the frame internally coherent: the canvas is then painted with
      // the camera that pins the toggled node exactly where the same frame's
      // interpolated box puts it. Applying it after `render()` instead — as
      // this used to — left every frame drawn with the PREVIOUS frame's
      // camera against THIS frame's positions, i.e. a one-frame lag against a
      // curve whose speed peaks mid-transition. That reads as the pinned node
      // (typically the root) sliding off its spot along the growth-axis
      // cross direction and swinging back as the curve decelerates — the
      // owner's "toggling the root sloshes left/right" report. The anchor
      // ESTABLISHED by this frame's own relayout still has to be resolved
      // after `render()` (its `toCentre` needs the layout that render just
      // produced); at `t = 0` it has nothing to advance yet, so there is no
      // lag to inherit.
      if (cameraAnchor !== null) applyCameraAnchor(now)
      // The engine's expand/collapse transition is a pure function of time and
      // takes its clock from here, the same discipline `viewport.ts` follows.
      drawn = await chartHost.render(now)
      // Layout output only changes on relayout, but reading it every frame is a
      // property access, and it keeps the overlay from ever using stale boxes.
      boxes = chartHost.boxes
      bounds = chartHost.bounds
      refreshRenderBoxBySource()
      recomputeLimits()
      // Identity changes only on relayout, which is exactly when the reverse
      // map is stale.
      if (chartHost.visibleToSource !== visibleToSource) {
        visibleToSource = chartHost.visibleToSource
        rebuildPrunedIndex()
      }
      if (needsInitialFit && bounds.maxX > bounds.minX && bounds.maxY > bounds.minY) {
        needsInitialFit = false
        // Deliberately NOT `animateTo`: the opening camera must appear already
        // positioned. Tweening in from an arbitrary starting camera on load
        // would read as a glitch, not a courtesy.
        camera = openingCamera()
        chartHost.setCamera(camera)
        drawn = await chartHost.render(now)
        boxes = chartHost.boxes
        refreshRenderBoxBySource()
      }
      // Runs after the relayout above, so it sees the boxes the toggle actually
      // produced rather than stale ones from before it.
      if (pendingPin !== null) {
        const pin = pendingPin
        pendingPin = null
        const index = tree.idToIndex.get(pin.id)
        const box = index === undefined ? null : boxOfSource(index)
        if (box !== null) {
          const now = worldToScreen(camera, box.x + box.w / 2, box.y + box.h / 2)
          camera = pan(camera, pin.screen.x - now.x, pin.screen.y - now.y)
          chartHost.setCamera(camera)
        }
      }
      if (pendingFullFit) {
        pendingFullFit = false
        pendingAnchor = null
        cameraAnchor = null
        api.fit()
      } else if (pendingAnchor !== null) {
        const anchor = pendingAnchor
        pendingAnchor = null
        // The node's post-relayout box — always present (see `CameraAnchor`'s
        // docblock), but degrade to "no anchor" rather than trust that if it
        // somehow isn't.
        const toBox = boxOfSource(anchor.source)
        cameraAnchor =
          toBox === null
            ? null
            : {
                source: anchor.source,
                screenX: anchor.screenX,
                screenY: anchor.screenY,
                fromCentre: anchor.fromCentre,
                toCentre: boxCentre(toBox),
                opening: anchor.opening,
                // The ENGINE's own origin for the transition this anchor
                // rides, never this frame's timestamp — the two are not the
                // same instant, and the difference is a phase error on a
                // curve rather than a constant offset. In worker mode the
                // engine relayouts the moment the `open` message is dequeued,
                // i.e. when the click happened, up to a frame before this
                // callback's `now`; the anchor then ran ~16ms behind what the
                // canvas was painting and the "pinned" node slid out and back
                // by a couple of pixels. Falls back to `now` only if the
                // engine reports no transition at all (animation disabled, or
                // it already finished within this same frame), where the
                // anchor resolves at `t = 1` immediately anyway.
                startedAt: chartHost.transitionStartedAt ?? now,
              }
        // Only the frame that ESTABLISHES an anchor applies it here; every
        // later frame advances it before `render()` instead (see the call at
        // the top of this callback, and its docblock, for why). At `t = 0`
        // this is a no-op on the camera in the common case — the anchor is
        // built from where the node already is — so running it after the
        // render costs the frame nothing.
        applyCameraAnchor(now)
      }
      // Retried rather than dropped while the node still has no box: a
      // request made against a layout that has not been rebuilt yet waits
      // for the frame that has one, which is the failure this deferral
      // exists to fix in the first place.
      if (pendingFocus !== null && moveToSource(pendingFocus.source, pendingFocus.ring)) {
        pendingFocus = null
      }
      if (minimap !== null) {
        // Identity check, not "every frame": `computeSilhouette` walks every
        // node, so it only runs when `boxes` is actually a NEW array, i.e. a
        // real relayout happened — see `lastMinimapBoxes`'s docblock.
        //
        // ...and not WHILE a transition is running, even though the new boxes
        // are already available. The silhouette and the transform derived with
        // it define the minimap's whole coordinate space, and taking up the
        // final layout's space mid-transition puts the minimap in a different
        // one from the canvas: the viewport rectangle is still drawn from a
        // camera that has not travelled there yet, so it lands somewhere the
        // user is not looking — far to one side on a root expand, where the
        // layout's own origin moves most — and then slides across the minimap
        // as the camera catches up. Holding the pre-toggle layout for the
        // duration keeps the minimap agreeing with what the canvas is actually
        // showing, and the one update lands when everything has settled. The
        // frame loop guarantees this runs: `scheduleFrame` keeps asking for
        // frames while `transitioning` is true, so there is always a frame
        // after it goes false.
        if (boxes !== lastMinimapBoxes && !chartHost.transitioning) {
          lastMinimapBoxes = boxes
          // The root is the anchor the minimap holds still across a relayout
          // — see `Minimap.onLayout`. It is the one node a reader orients
          // themselves by, it is what the chart's own camera anchor most
          // often pins, and it is also the node whose world position a
          // collapse moves furthest (tidy stops centring it over children it
          // no longer has).
          const rootIndex = tree.roots[0]
          const rootBox = rootIndex === undefined ? null : boxOfSource(rootIndex)
          // `minimapNeedsRefit` is the "this is a different tree" signal —
          // isolating replaces what the map is a map OF, and holding the old
          // frame steady then leaves the branch drawn in the corner the whole
          // org used to occupy rather than filling the widget.
          const refit = minimapNeedsRefit
          minimapNeedsRefit = false
          if (rootBox === null) minimap.onLayout(boxes, bounds, undefined, refit)
          else minimap.onLayout(boxes, bounds, boxCentre(rootBox), refit)
        }
        // Cheap by contrast: two point transforms and a CSS transform write.
        //
        // The anchor here is the root's INTERPOLATED position — where it is
        // being drawn this frame, not where it will settle — because that is
        // what the camera is pinned against mid-transition. Feeding the
        // settled position instead would put the rectangle back on the same
        // sliding path this exists to remove.
        const rect = host.getBoundingClientRect()
        const liveRootIndex = tree.roots[0]
        const liveRootBox = liveRootIndex === undefined ? null : interpolatedBoxOfSource(liveRootIndex)
        const size = { width: rect.width, height: rect.height }
        if (liveRootBox === null) minimap.onCamera(camera, size)
        else minimap.onCamera(camera, size, boxCentre(liveRootBox))
      }
      refreshA11y()
      if (overlay !== null) {
        if (overlayEnabled(camera.k, lod) && currentOptions.renderNode !== undefined) {
          overlay.update(
            Array.from(drawn, (index) => ({ index, id: tree.indexToId[index]! })),
            interpolatedBoxOfSource,
            camera,
            alphaOfSource,
          )
        } else {
          overlay.update([], interpolatedBoxOfSource, camera, alphaOfSource)
        }
      }
      publish()

      // A layout transition (or the toggle ring) advances only when a frame is
      // drawn, so keep asking for frames until BOTH finish. Nothing else would
      // drive either: the camera may be perfectly still while the nodes are
      // still moving, or while the ring is still fading. Checking only
      // `transitioning` here was the bug behind "the ring doesn't fade" — the
      // ring's `RING_DURATION_MS` (350ms) deliberately outlives the layout
      // transition's `TRANSITION_DURATION_MS` (250ms, see engine.ts), so a
      // toggle with no other camera/hover activity stopped scheduling frames
      // the instant the transition ended and froze the ring wherever its alpha
      // happened to be at that moment, rather than letting it finish fading.
      if (chartHost.transitioning || chartHost.ringActive) scheduleFrame()
    })
  }

  /**
   * Centres the camera on a node and, if asked, flashes the confirmation ring
   * on it. Returns `false` — having done nothing — when the node has no box
   * in the CURRENT layout, i.e. it is collapsed away and the caller must wait
   * for the relayout that reveals it (see `KladApi.focus`).
   */
  const moveToSource = (source: number, ring: boolean): boolean => {
    const box = boxOfSource(source)
    if (box === null) return false
    const rect = host.getBoundingClientRect()
    const flash =
      ring && currentOptions.ring !== false
        ? () => {
            chartHost.flashRing(source)
            scheduleFrame()
          }
        : undefined
    // The ring fires on ARRIVAL, not on departure. Armed at the start it
    // spends its opening — the brightest part, before the fade — playing out
    // while the camera is still travelling, so what reaches the eye at the
    // destination is whatever is left of it. Waiting for the tween means the
    // whole flash happens where the user is looking.
    animateTo(
      {
        x: rect.width / 2 - (box.x + box.w / 2) * camera.k,
        y: rect.height / 2 - (box.y + box.h / 2) * camera.k,
        k: camera.k,
      },
      flash,
    )
    return true
  }

  /** Applies a camera value immediately: no easing, no animation bookkeeping. */
  const applyCamera = (next: Camera): void => {
    camera = next
    chartHost.setCamera(camera)
    emit('viewportChange', { camera })
    scheduleFrame()
  }

  /**
   * Advances the active `cameraAnchor`, if any, for the current frame — see
   * its docblock for the overall design. Two cases:
   *
   *  - Reduced motion / `animate: false`: the engine skips its own transition
   *    entirely and snaps straight to the final layout, so there is nothing
   *    to track frame by frame. Jump the camera once, using the node's FINAL
   *    centre (`t = 1`), and drop the anchor immediately — "jump straight to
   *    the final layout with the node anchored, no tween", per the brief.
   *  - Animated and still running: `transitionAnchorProgress` replays the
   *    engine's OWN reposition curve for this one node to find exactly where
   *    its centre is RIGHT NOW, and the camera is solved so that point maps
   *    to the fixed screen anchor. Dropped the instant the engine's own
   *    transition ends — after that both ends of the interpolation are the
   *    SAME point, so there is nothing left for it to do, and the camera it
   *    leaves behind already holds the node exactly at its pinned spot.
   */
  const applyCameraAnchor = (now: number): void => {
    const anchor = cameraAnchor
    if (anchor === null) return
    const stillAnimating = animationsEnabled() && chartHost.transitioning
    const t = stillAnimating ? transitionAnchorProgress(anchor.startedAt, now, anchor.opening) : 1
    const world = lerpPoint(anchor.fromCentre, anchor.toCentre, t)
    const nextCamera = { x: anchor.screenX - world.x * camera.k, y: anchor.screenY - world.y * camera.k, k: camera.k }
    applyCamera(nextCamera)
    if (!stillAnimating) cameraAnchor = null
  }

  /**
   * Keeps the engine's transition setting in step with ours. The engine cannot
   * read `prefers-reduced-motion` — it has no DOM — so this layer owns the
   * decision and pushes it down.
   */
  const syncAnimate = (): void => {
    chartHost.setAnimate(animationsEnabled())
  }

  const prefersReducedMotion = (): boolean =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /**
   * Whether this layer is allowed to animate a camera move on its own
   * initiative right now. `false` covers both the explicit `animate: false`
   * option and the OS `prefers-reduced-motion: reduce` setting — the latter is
   * not optional polish, an unrequested 200ms slide (or a coasting pan) is
   * exactly what that setting exists to suppress.
   */
  const animationsEnabled = (): boolean => currentOptions.animate !== false && !prefersReducedMotion()

  const TWEEN_MS = 200

  /**
   * Shared by the ease-tween (`animateTo`) and the momentum coast
   * (`startMomentum`) — only one of the two is ever running, and cancelling
   * one is indistinguishable from cancelling the other from the caller's side.
   * Camera-changing pointer/wheel/pinch input always goes through
   * `setCameraInstant`, which clears this before applying its own change —
   * that is the whole cancellation rule in one place: **the user's hand on the
   * canvas always wins immediately**, whether what it's interrupting is a
   * `focus()` tween or a kinetic-pan coast.
   */
  let cameraAnimHandle: number | null = null
  /**
   * Run once when the current `animateTo` tween reaches its target, then
   * cleared. Dropped — never called — if the tween is cancelled, because
   * whatever the callback was for ("now that we have arrived...") is exactly
   * what a cancellation means did not happen.
   */
  let onTweenArrive: (() => void) | null = null
  let tweenFrom: Camera | null = null
  let tweenTo: Camera | null = null
  let tweenStart = 0
  let momentumVX = 0
  let momentumVY = 0
  let momentumLastT = 0

  /**
   * `dropToggleAnchor` distinguishes the two things this cancels, which are
   * not the same event:
   *
   *  - A `focus()` tween or a momentum coast is a camera animation the user
   *    is interrupting. Merely TOUCHING the canvas should stop it dead —
   *    that is the "the user's hand always wins immediately" rule.
   *  - The toggle camera anchor is not a camera animation the user started.
   *    It is what holds the node they just toggled still while the layout
   *    moves underneath it, and the layout keeps moving whether the anchor
   *    lives or not. Dropping it on a bare `pointerdown` — which is what this
   *    used to do unconditionally — abandoned the node mid-transition: the
   *    tree carried on to its final positions with nothing holding it, so a
   *    tap anywhere during a root collapse left the root somewhere else
   *    entirely, often off screen.
   *
   * So a real camera GESTURE (pan, wheel, pinch, or an API move) still drops
   * the anchor — those all route through `setCameraInstant`/`animateTo`,
   * which take the default — while a touch that changes no camera does not.
   */
  const cancelCameraAnimation = (dropToggleAnchor = true): void => {
    if (cameraAnimHandle !== null) {
      cancelAnimationFrame(cameraAnimHandle)
      cameraAnimHandle = null
    }
    tweenFrom = null
    tweenTo = null
    onTweenArrive = null
    momentumVX = 0
    momentumVY = 0
    if (dropToggleAnchor) {
      cameraAnchor = null
      pendingAnchor = null
    }
  }

  /** Used by pointer, wheel, and pinch input — see `cancelCameraAnimation`. */
  const setCameraInstant = (next: Camera): void => {
    cancelCameraAnimation()
    applyCamera(next)
  }

  const stepTween = (now: number): void => {
    if (destroyed || tweenFrom === null || tweenTo === null) {
      cameraAnimHandle = null
      return
    }
    const t = Math.min(1, (now - tweenStart) / TWEEN_MS)
    applyCamera(interpolate(tweenFrom, tweenTo, easeInOutCubic(t)))
    if (t >= 1) {
      cameraAnimHandle = null
      tweenFrom = null
      tweenTo = null
      const arrived = onTweenArrive
      onTweenArrive = null
      arrived?.()
      return
    }
    cameraAnimHandle = requestAnimationFrame(stepTween)
  }

  /**
   * Entry point for every API-triggered camera move: `focus`, `fit`, `reset`,
   * `zoomTo`/`zoomIn`/`zoomOut`, and the accessibility layer's
   * focus-follows-camera (via `focus`).
   *
   * A second call while a tween (or a momentum coast) is already under way
   * does not snap back to restart from the original starting point — it
   * retargets from `camera`, i.e. wherever the animation has actually gotten
   * to *right now*. Since cancelling and re-issuing from that same live value
   * changes nothing visible, this reads as "now heading somewhere else"
   * rather than a stutter.
   */
  const animateTo = (target: Camera, onArrive?: () => void): void => {
    cancelCameraAnimation()
    if (!animationsEnabled()) {
      applyCamera(target)
      onArrive?.()
      return
    }
    onTweenArrive = onArrive ?? null
    tweenFrom = { ...camera }
    tweenTo = target
    tweenStart = performance.now()
    cameraAnimHandle = requestAnimationFrame(stepTween)
  }

  // Kinetic panning: released with a velocity estimated from a short rolling
  // window of recent pointer samples (see input.ts), not the single last
  // delta — a momentary jitter right at release must not fling the chart.
  // Decays exponentially and stops once it drops below a small threshold.
  // Total glide distance is roughly release velocity x tau, so tau is the knob
  // that decides how far a flick carries. 300ms was the first guess and read as
  // too fast in use — the chart ran away from the finger. 180ms keeps the coast
  // obviously present without overshooting what the user aimed at.
  const MOMENTUM_TAU_MS = 180
  const MOMENTUM_MIN_VELOCITY = 0.02 // px/ms (~20px/s) — below this, stop rather than crawl forever.
  // Clamps a sample-noise spike into something a hand could plausibly have done.
  const MOMENTUM_MAX_VELOCITY = 2 // px/ms (~2000px/s)

  const stepMomentum = (now: number): void => {
    if (destroyed) {
      cameraAnimHandle = null
      return
    }
    const dt = now - momentumLastT
    momentumLastT = now
    applyCamera(pan(camera, momentumVX * dt, momentumVY * dt))
    const decay = Math.exp(-dt / MOMENTUM_TAU_MS)
    momentumVX *= decay
    momentumVY *= decay
    if (Math.hypot(momentumVX, momentumVY) < MOMENTUM_MIN_VELOCITY) {
      cameraAnimHandle = null
      momentumVX = 0
      momentumVY = 0
      return
    }
    cameraAnimHandle = requestAnimationFrame(stepMomentum)
  }

  /** `vx`/`vy` are screen px/ms, as measured by input.ts at pointer release. */
  const startMomentum = (vx: number, vy: number): void => {
    cancelCameraAnimation()
    if (!animationsEnabled()) return
    const speed = Math.hypot(vx, vy)
    if (speed < MOMENTUM_MIN_VELOCITY) return
    const scale = speed > MOMENTUM_MAX_VELOCITY ? MOMENTUM_MAX_VELOCITY / speed : 1
    momentumVX = vx * scale
    momentumVY = vy * scale
    momentumLastT = performance.now()
    cameraAnimHandle = requestAnimationFrame(stepMomentum)
  }

  const setOpenFlag = (index: number, value: boolean): void => {
    if (currentOptions.autoPanOnToggle !== false) {
      // `interpolatedBoxOfSource`, not `boxOfSource`: toggling a DIFFERENT
      // node than whichever one a PRIOR toggle's anchor is already holding
      // (the `cameraAnchor.source === index` branch below handles the SAME-
      // node case on its own, via the anchor's own curve) can land while
      // that earlier transition is still running — the final-layout box
      // would then disagree with wherever `index` actually reads on screen
      // right now, producing exactly the snap this whole feature exists to
      // avoid.
      const box = interpolatedBoxOfSource(index)
      if (box !== null) {
        const centre = boxCentre(box)
        let fromCentre = centre
        let screenX = centre.x * camera.k + camera.x
        let screenY = centre.y * camera.k + camera.y
        if (cameraAnchor !== null && cameraAnchor.source === index) {
          // Re-toggling the SAME node the anchor is already holding: keep the
          // exact same pin point (not the FINAL box's screen position, which
          // during a transition is generally NOT where the node currently
          // reads on screen), and continue from wherever it visually is right
          // now — via the same curve `applyCameraAnchor` used to put it there
          // — rather than the stale final box `boxOfSource` would otherwise
          // give. This is the camera-side half of "a second toggle
          // mid-transition retargets instead of snapping".
          const now = performance.now()
          const stillAnimating = animationsEnabled() && chartHost.transitioning
          const t = stillAnimating
            ? transitionAnchorProgress(cameraAnchor.startedAt, now, cameraAnchor.opening)
            : 1
          fromCentre = lerpPoint(cameraAnchor.fromCentre, cameraAnchor.toCentre, t)
          screenX = cameraAnchor.screenX
          screenY = cameraAnchor.screenY
        }
        pendingAnchor = { source: index, screenX, screenY, fromCentre, opening: value }
      }
    }
    open[index] = value ? 1 : 0
    // A single-node toggle — the exact case the ring exists for — so `ring`
    // would be `true` here (matching the engine's default, and every OTHER
    // `chartHost.setOpen` call site in this file has to say `false`
    // explicitly; see engine.ts's `setOpen` for the contract) UNLESS this
    // layer's own `ring` option turns the confirmation flash off entirely
    // (see `Options.ring`'s docblock).
    chartHost.setOpen(index, value, currentOptions.ring !== false)
    emit('toggle', { id: tree.indexToId[index]!, open: value })
    a11yDirty = true
    scheduleFrame()
  }

  const resize = (): void => {
    const rect = host.getBoundingClientRect()
    chartHost.setViewport(rect.width, rect.height, window.devicePixelRatio || 1)
    scheduleFrame()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(host)

  /**
   * Two taps on the same node within this window count as a double click —
   * 300ms is the conventional platform figure (there is no portable API to
   * read the OS value, so it is hard-coded, same as elsewhere in the web
   * platform's own implementations).
   */
  const DOUBLE_CLICK_MS = 300
  let lastTapId: string | null = null
  let lastTapAt = 0

  /**
   * True when `target` is (or is contained in) a genuinely interactive
   * element — a `<button>`, a link, a form control, or an editable region —
   * bounded to inside `host` so a match somewhere ABOVE the chart in the
   * page (an accident of DOM nesting this chart didn't create) never counts.
   * Used only by `toggleOnNodeClick`, to keep a card's own toggle button (or
   * any other control) from also toggling the node underneath it — see that
   * option's docblock for the full contract.
   */
  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false
    const interactive = target.closest('button, a, input, select, textarea, [contenteditable]')
    return interactive !== null && host.contains(interactive)
  }

  let hoveredId: string | null = null
  const setHover = (id: string | null, item: NodeData | null): void => {
    if (id === hoveredId) return
    hoveredId = id
    emit('nodeHover', id === null ? { id: null, item: null } : { id, item: item! })
  }

  /**
   * Sets the selection, pushes it to the renderer and tells the host — the one
   * path every way of selecting goes through (a click, a region drag,
   * `select()`), so none of them can forget one of the three.
   *
   * Unknown ids are dropped rather than kept as ghosts: a caller handing back
   * a stored list should get a selection of what still exists, and the event
   * should say what is actually selected.
   */
  const applySelection = (ids: readonly string[]): void => {
    const kept: string[] = []
    const indices: number[] = []
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) continue
      const index = tree.idToIndex.get(id)
      if (index === undefined) continue
      seen.add(id)
      kept.push(id)
      indices.push(index)
    }
    const unchanged =
      kept.length === selectedIds.length && kept.every((id, i) => id === selectedIds[i])
    if (unchanged) return

    selectedIds = kept
    chartHost.setSelection(indices.length === 0 ? null : Uint32Array.from(indices))
    scheduleFrame()
    emit('selectionChange', {
      ids: [...kept],
      items: kept.map((id) => itemById.get(id)).filter((item): item is NodeData => item !== undefined),
    })
  }

  const detachKeys =
    options.keyboard === false
      ? () => {}
      : attachKeys(host, () => limits, {
          getCamera: () => camera,
          setCamera: setCameraInstant,
          cancelAnimation: () => cancelCameraAnimation(false),
          viewport: () => {
            const rect = host.getBoundingClientRect()
            return { width: rect.width, height: rect.height }
          },
          fit: () => api.fit(),
          reset: () => api.reset(),
          goToRoot: () => {
            const rootId = tree.indexToId[tree.roots[0] ?? 0]
            if (rootId !== undefined) api.focus(rootId)
          },
          clearHighlight: () => {
            // Both, in one press: to a viewer they are the same "never mind",
            // and a chart that needed two presses to drop what it was showing
            // would be counting its own internal distinctions out loud.
            api.highlight(null)
            applySelection([])
          },
        })

  /**
   * Which visible nodes a dragged region covers, in screen space.
   *
   * Screen space rather than world, because that is where the gesture
   * happened: converting the region back into world coordinates would be the
   * same arithmetic in the other direction, and would go wrong the moment the
   * camera moved mid-drag.
   *
   * A box takes any node it OVERLAPS, a lasso takes any node whose centre it
   * contains. That asymmetry is the conventional one, and it is right for the
   * shapes: a box is dragged across things, a lasso is drawn around them.
   */
  const nodesInRegion = (points: { x: number; y: number }[], lasso: boolean): string[] => {
    const found: string[] = []
    const minX = Math.min(...points.map((p) => p.x))
    const maxX = Math.max(...points.map((p) => p.x))
    const minY = Math.min(...points.map((p) => p.y))
    const maxY = Math.max(...points.map((p) => p.y))

    for (let i = 0; i < visibleToSource.length; i++) {
      const o = i * 4
      const x = boxes[o]! * camera.k + camera.x
      const y = boxes[o + 1]! * camera.k + camera.y
      const w = boxes[o + 2]! * camera.k
      const h = boxes[o + 3]! * camera.k
      // The bounding box first either way: for a box it IS the test, and for
      // a lasso it rejects almost everything before the polygon maths runs.
      if (x + w < minX || x > maxX || y + h < minY || y > maxY) continue
      if (lasso && !pointInPolygon({ x: x + w / 2, y: y + h / 2 }, points)) continue
      const id = tree.indexToId[visibleToSource[i]!]
      if (id !== undefined) found.push(id)
    }
    return found
  }

  const detachMarquee =
    options.selection === true
      ? attachMarquee(host, {
          onRegion(points, additive) {
            const ids = nodesInRegion(points, points.length > 2)
            applySelection(additive ? [...selectedIds, ...ids] : ids)
          },
        })
      : () => {}

  /**
   * The overlay element currently showing node `source`, or `null` when the
   * chart is not drawing cards at this zoom (or this node is off screen).
   *
   * The overlay pools its elements by SLOT rather than by node — see
   * `createOverlay` — so there is no map from a node to its element, and
   * building one would mean the pool telling the world about an internal
   * detail it exists to hide. Reading the id back off the element it wrote is
   * cheap enough for a gesture that happens once.
   */
  const overlayElementOf = (source: number): HTMLElement | null => {
    const id = tree.indexToId[source]
    if (id === undefined) return null
    for (const element of host.querySelectorAll<HTMLElement>('.klad-overlay-node')) {
      if (element.dataset.kladId === id) return element
    }
    return null
  }

  const detachInput = attachInput(host, () => limits, {
    getCamera: () => camera,
    setCamera: setCameraInstant,
    // Input calls this on `pointerdown`/wheel, before it knows whether a
    // camera gesture is coming: stop a tween or coast, but leave the toggle
    // anchor alone (see `cancelCameraAnimation`). Anything that actually
    // moves the camera reports through `setCamera` above, which is
    // `setCameraInstant` — and that drops the anchor.
    cancelAnimation: () => cancelCameraAnimation(false),
    onTap(screenX, screenY, target, modifiers) {
      const world = screenToWorld(camera, screenX, screenY)
      void chartHost.hitTest(world.x, world.y).then((index) => {
        if (destroyed) return
        if (index === -1) {
          lastTapId = null
          // Clicking the background clears the selection, unless the click was
          // asking to add to it — the same rule as a file manager, where a
          // plain click on empty space means "never mind".
          if (currentOptions.selection === true && !modifiers.additive && !modifiers.extend) {
            applySelection([])
          }
          return
        }
        const id = tree.indexToId[index]!
        const item = itemFor(index)
        const now = performance.now()
        const isDoubleClick = id === lastTapId && now - lastTapAt <= DOUBLE_CLICK_MS
        if (isDoubleClick) {
          // Consumed: a third tap starts a fresh pair rather than chaining
          // into another double click.
          lastTapId = null
          // Deliberately does NOT also emit a second `nodeClick` for this tap:
          // the first tap of the pair already emitted its own `nodeClick`
          // below, so a listener that only wants single clicks still sees
          // exactly one, and a listener that wants both isn't forced to
          // de-duplicate a same-node, same-instant click it didn't ask for.
          // For the same reason, this is also NOT where `toggleOnNodeClick`
          // toggles: the first tap of the pair already did that below, so a
          // double click toggles once overall, not twice — see that option's
          // docblock.
          emit('nodeDblClick', { id, item })
        } else {
          lastTapId = id
          lastTapAt = now
          if (currentOptions.selection === true && !isInteractiveTarget(target)) {
            // Plain click replaces, ctrl/cmd toggles one, shift adds — the
            // conventions of every list a person has ever multi-selected in.
            // "Extend a range" is deliberately not one of them: a range in a
            // tree has no obvious meaning, and guessing one (preorder? same
            // parent?) is worse than adding the node they clicked.
            if (modifiers.additive) {
              applySelection(
                selectedIds.includes(id)
                  ? selectedIds.filter((selected) => selected !== id)
                  : [...selectedIds, id],
              )
            } else if (modifiers.extend) {
              applySelection([...selectedIds, id])
            } else {
              applySelection([id])
            }
          }
          // `nodeClick` always fires first, unconditionally — see
          // `toggleOnNodeClick`'s docblock for why the toggle is an
          // unsuppressable side effect of this event rather than a
          // competing one.
          emit('nodeClick', { id, item })
          if (currentOptions.toggleOnNodeClick === true && !isInteractiveTarget(target)) {
            const hasChildren = canHaveChildren(index)
            // A leaf has nothing to toggle — do nothing rather than emit a
            // pointless `toggle` event for it.
            if (!hasChildren) return
            if (open[index] === 1) setOpenFlag(index, false)
            else requestOpen(index)
          }
        }
      })
    },
    onMove(screenX, screenY) {
      if (destroyed) return
      const world = screenToWorld(camera, screenX, screenY)
      void chartHost.hitTest(world.x, world.y).then((index) => {
        if (destroyed) return
        if (index === -1) {
          setHover(null, null)
          return
        }
        setHover(tree.indexToId[index]!, itemFor(index))
      })
    },
    onLeave() {
      if (destroyed) return
      setHover(null, null)
    },
    onRelease(vx, vy) {
      startMomentum(vx, vy)
    },
    onDragStart(screenX, screenY) {
      if (currentOptions.dragAndDrop !== true) return false
      const world = screenToWorld(camera, screenX, screenY)
      // The synchronous mirror, not `chartHost.hitTest` — that returns a
      // promise in worker mode, and by the time it resolved the gesture would
      // already have been panning for a frame or two. `boxOfSource` and the
      // pruned index are both on this thread; see `hitTestLocal`.
      const index = hitTestLocal(world.x, world.y)
      if (index === -1) return false

      // Dragging a node that is in the selection carries the whole selection;
      // dragging one outside it carries just that node and leaves the
      // selection alone. Same rule as a file manager, and the same reason: a
      // drag is not a selection gesture.
      const id = tree.indexToId[index]!
      dragIds = selectedIds.includes(id) ? [...selectedIds] : [id]
      const roots = dragIds.map((each) => tree.idToIndex.get(each)).filter((i): i is number => i !== undefined)
      // Built once, here, and read as one array lookup per pointer move —
      // see `subtreeMask`. The alternative walks the ancestor chain on every
      // move, at pointer frequency, on a tree of unbounded depth.
      dragMask = subtreeMask(tree, roots)
      chartHost.setDrag(index)
      // The card the pointer picked up, if the chart is drawing cards at this
      // zoom — see `createDragGhost` for the fallback when it is not.
      dragGhost.show(overlayElementOf(index), labelOf(itemFor(index)), dragIds.length)
      dragGhost.move(screenX, screenY)
      host.classList.add('klad-dragging')
      setDragCursor('grabbing')
      scheduleFrame()
      return true
    },

    onDragMove(screenX, screenY) {
      dragGhost.move(screenX, screenY)
      updateEdgePan(screenX, screenY)
      const world = screenToWorld(camera, screenX, screenY)
      const index = hitTestLocal(world.x, world.y)
      if (index === -1 || dragMask === null) {
        setDropTarget(-1, 'into', true)
        cancelSpring()
        return
      }
      const box = boxOfSource(index)
      if (box === null) {
        setDropTarget(-1, 'into', true)
        cancelSpring()
        return
      }
      const mode = resolveDropMode(
        currentOptions.layout ?? 'tidy',
        currentOptions.layout === 'tidy' &&
          (currentOptions.orientation === 'lr' || currentOptions.orientation === 'rl'),
        box,
        world.x,
        world.y,
      )
      // `dragMask` is over SOURCE indices, which is what `hitTestLocal`
      // answers in — the pruned space changes as branches open and this
      // gesture outlives that.
      setDropTarget(index, mode, isDropAllowed(dragMask, index))
      // Only an "into" hover springs a folder. On the leading or trailing
      // quarter the viewer is aiming BETWEEN two rows, and opening the one
      // they are beside would push their target out from under them.
      armSpring(mode === 'into' ? index : -1)
    },
    onDragEnd() {
      const target = dropTargetIndex
      const mode = dropTargetMode
      const valid = dropTargetValid
      const ids = dragIds
      const landed = target !== -1 && valid && ids.length > 0

      teardownDrag()
      // The branch the drop landed in stays open; everything else this drag
      // sprang open on the way closes again. A refused or missed drop landed
      // nowhere, so nothing is kept.
      collapseSprung(landed ? target : -1)

      if (!landed) return
      emitDrop(ids, target, mode)
    },
    onDragCancel() {
      teardownDrag()
      // Escape means "none of this happened", and a folder that sprang open
      // under the pointer is part of "this".
      collapseSprung(-1)
    },
  })

  const api: KladApi = {
    zoomTo(k) {
      const rect = host.getBoundingClientRect()
      animateTo(zoomAt(camera, rect.width / 2, rect.height / 2, k / camera.k, limits))
    },
    zoomIn() {
      api.zoomTo(camera.k * 1.25)
    },
    zoomOut() {
      api.zoomTo(camera.k / 1.25)
    },
    fit() {
      const rect = host.getBoundingClientRect()
      animateTo(fitCamera(bounds, { width: rect.width, height: rect.height }, FIT_PADDING, limits))
    },
    fitSubtree(id) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      // Only what is on screen-able: `boxOfSource` returns null for anything
      // inside a collapsed branch, and framing room for nodes the viewer
      // cannot see would leave the ones they can see smaller than they need
      // to be. A subtree whose own root is collapsed away has no box at all,
      // and there is nothing to frame.
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const source of subtreeOf(tree, index)) {
        const box = boxOfSource(source)
        if (box === null) continue
        minX = Math.min(minX, box.x)
        minY = Math.min(minY, box.y)
        maxX = Math.max(maxX, box.x + box.w)
        maxY = Math.max(maxY, box.y + box.h)
      }
      if (minX === Infinity) return
      const rect = host.getBoundingClientRect()
      animateTo(
        fitCamera({ minX, minY, maxX, maxY }, { width: rect.width, height: rect.height }, FIT_PADDING, limits),
      )
    },
    setCentre(id) {
      const next = id === null ? -1 : (tree.idToIndex.get(id) ?? -1)
      if (next === centreIndex()) return
      currentOptions = { ...currentOptions, centre: id }
      chartHost.setFocus(next)
      a11yDirty = true
      // Deliberately no fit and no camera move at all, unlike `isolate`. A
      // sunburst's bounds do not depend on which node is centred — the wheel
      // is always the same square with the hub at its middle — so the whole
      // drill-down happens inside a frame that never shifts. Refitting here
      // would add a camera animation on top of the geometry animation and
      // undo the one thing that makes this read as zooming into the chart
      // rather than replacing it.
      scheduleFrame()
    },
    getCentre() {
      return currentOptions.centre ?? null
    },
    isolate(id) {
      const next = id === null ? -1 : (tree.idToIndex.get(id) ?? -1)
      if (next === isolatedIndex) return
      isolatedIndex = next
      chartHost.setIsolate(next)
      minimapNeedsRefit = true
      a11yDirty = true
      // The chart now contains a different set of nodes, at different
      // positions: whatever the camera was framing is gone or has moved. A
      // fit is the only view that is certainly meaningful afterwards, and it
      // is what makes isolating feel like arriving somewhere.
      pendingFullFit = true
      scheduleFrame()
    },
    filter(query) {
      filterQuery = query
      const matches = applyFilter()
      minimapNeedsRefit = true
      a11yDirty = true
      // The chart now contains a different set of nodes at different
      // positions, so whatever the camera was framing has moved or gone —
      // same reasoning as `isolate`.
      pendingFullFit = true
      scheduleFrame()
      return matches
    },
    reset() {
      api.fit()
    },
    focus(id, opts) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      const ring = opts?.ring === true
      api.expandTo(id)
      // Already on screen — which is every focus that expanded nothing, since
      // `expandTo` no-ops when the ancestors are open already — so its box is
      // current and the move can happen now. Worth the branch: deferring
      // unconditionally would delay the common case (search results,
      // focus-follows-keyboard) by a frame for no reason.
      if (!moveToSource(index, ring)) {
        pendingFocus = { source: index, ring }
        scheduleFrame()
      }
    },
    expand(id, deep = false) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      // The single-node case fetches if it has to; the deep case below does
      // not. "Open this and everything under it" is a request about a tree the
      // caller can see; on one that is still arriving it would fan out into a
      // request per node, of unknown number, that nobody meant to make. See
      // `Options.loadChildren`.
      if (!deep) return requestOpen(index)
      const stack = [index]
      // This is still ONE user action on ONE node — a deep expand of `index`
      // — even though it opens every descendant too. Only the very first
      // `setOpen` call here (always `index` itself: `stack` starts as
      // `[index]` alone, so the first pop is always it) asks for a ring;
      // every descendant this loop also opens passes `ring: false` so the
      // flash lands on the node the user actually acted on, not on whichever
      // descendant happens to resolve last. See engine.ts's `setOpen` for why
      // this explicit per-call signal replaced a distinct-index heuristic
      // that could not tell "one deep toggle" apart from a real bulk burst.
      // Starts at `false` outright when this layer's own `ring` option is
      // off (see `Options.ring`'s docblock) — there is then no node in this
      // deep toggle that should ever flash, not just the descendants.
      let ring = currentOptions.ring !== false
      while (stack.length > 0) {
        const node = stack.pop()!
        open[node] = 1
        chartHost.setOpen(node, true, ring)
        ring = false
        for (let c = tree.childStart[node]!; c < tree.childStart[node + 1]!; c++) {
          stack.push(tree.childIndex[c]!)
        }
      }
      a11yDirty = true
      scheduleFrame()
    },
    collapse(id, deep = false) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      if (!deep) return setOpenFlag(index, false)
      const stack = [index]
      // Same reasoning as `expand`'s deep branch above.
      let ring = currentOptions.ring !== false
      while (stack.length > 0) {
        const node = stack.pop()!
        open[node] = 0
        chartHost.setOpen(node, false, ring)
        ring = false
        for (let c = tree.childStart[node]!; c < tree.childStart[node + 1]!; c++) {
          stack.push(tree.childIndex[c]!)
        }
      }
      a11yDirty = true
      scheduleFrame()
    },
    expandAll() {
      for (let i = 0; i < tree.count; i++) {
        open[i] = 1
        // A real bulk operation: every call explicitly opts out of the ring
        // (flashing every node at once is the strobing effect the ring must
        // never produce), rather than relying on the engine to infer "bulk"
        // from how many distinct indices got touched.
        chartHost.setOpen(i, true, false)
      }
      a11yDirty = true
      // The whole chart just changed shape — a full fit is the sensible
      // response here, unlike the single-node case (see `pendingFullFit`).
      if (currentOptions.autoPanOnToggle !== false) pendingFullFit = true
      scheduleFrame()
    },
    collapseAll() {
      for (let i = 0; i < tree.count; i++) {
        open[i] = 0
        chartHost.setOpen(i, false, false) // see expandAll's comment
      }
      a11yDirty = true
      if (currentOptions.autoPanOnToggle !== false) pendingFullFit = true
      scheduleFrame()
    },
    expandTo(id) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      let node = tree.parent[index]!
      while (node !== -1) {
        open[node] = 1
        // Opens every ancestor in one synchronous burst on the way to
        // revealing `id` — not the single-node toggle case the ring exists
        // for, so this opts out explicitly rather than flashing whichever
        // ancestor happens to resolve last.
        chartHost.setOpen(node, true, false)
        node = tree.parent[node]!
      }
      a11yDirty = true
      scheduleFrame()
    },
    search(query) {
      const predicate =
        typeof query === 'function'
          ? query
          : (item: NodeData) => labelOf(item).toLowerCase().includes(query.toLowerCase())
      const results: SearchResult[] = []
      for (let i = 0; i < tree.count; i++) {
        const item = itemFor(i)
        if (!predicate(item)) continue
        const path: string[] = []
        let node = tree.parent[i]!
        while (node !== -1) {
          path.unshift(tree.indexToId[node]!)
          node = tree.parent[node]!
        }
        results.push({ id: tree.indexToId[i]!, item, path })
      }
      return results
    },
    stats(id) {
      const index = tree.idToIndex.get(id)
      return index === undefined ? null : statsOf(index)
    },
    pathTo(id) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return null
      const path = [id]
      let node = tree.parent[index]!
      while (node !== -1) {
        path.unshift(tree.indexToId[node]!)
        node = tree.parent[node]!
      }
      return path
    },
    refresh() {
      applyData(false)
      // `setData` clears highlight — it holds source indices, which a genuine
      // data swap invalidates. A refresh is not a data swap, so what the
      // caller had highlighted is put straight back.
      if (highlightedIds !== null) api.highlight(highlightedIds)
      scheduleFrame()
    },
    select(ids) {
      applySelection(ids ?? [])
    },
    getSelection() {
      return [...selectedIds]
    },
    highlight(ids) {
      highlightedIds = ids
      if (ids === null) {
        chartHost.setHighlight(null)
      } else {
        const indices = ids
          .map((id) => tree.idToIndex.get(id))
          .filter((i): i is number => i !== undefined)
        chartHost.setHighlight(Uint32Array.from(indices))
      }
      // No a11y refresh: highlighting does not change which nodes are expanded,
      // and the mirror rebuild is expensive enough that doing it per search would
      // be felt.
      scheduleFrame()
    },
    toSVG(opts) {
      return coreToSVG(buildExportData(), opts)
    },
    // `Frame`/`createCanvas2DRenderer` are core's, but the canvas that backs
    // this — an OffscreenCanvas that never touches `host` or the visible
    // chart — is unavoidably DOM-bound, which is exactly why this method
    // lives here and not in core.
    async toBlob(opts) {
      if (typeof OffscreenCanvas === 'undefined') {
        throw new Error('Klad: toBlob() requires OffscreenCanvas, unavailable in this environment')
      }
      const scale = opts.scale ?? 1
      const data = buildExportData()
      const cssWidth = Math.max(1, data.bounds.maxX - data.bounds.minX) + EXPORT_PADDING * 2
      const cssHeight = Math.max(1, data.bounds.maxY - data.bounds.minY) + EXPORT_PADDING * 2

      const surface = new OffscreenCanvas(
        Math.max(1, Math.round(cssWidth * scale)),
        Math.max(1, Math.round(cssHeight * scale)),
      )
      // Cast through `unknown`, exactly like `host.ts`'s own main-thread
      // fallback does for a real `HTMLCanvasElement`: the DOM lib's
      // `roundRect`/`measureText` overloads are narrower than
      // `RenderContext2D`'s structural declaration, which fails strict
      // parameter-type assignability even though every call this renderer
      // makes is valid at runtime.
      const renderer = createCanvas2DRenderer(surface as unknown as RenderSurface, theme, (font) => {
        const probe = new OffscreenCanvas(1, 1).getContext('2d')
        if (probe === null) throw new Error('Klad: 2D canvas context unavailable')
        probe.font = font
        return createTextMeasurer({ measureWidth: (t) => probe.measureText(t).width })
      })
      renderer.resize(cssWidth, cssHeight, scale)

      const n = data.parent.length
      // Every node, every edge, no culling — see this method's contract in
      // `KladApi`. `edges`/`visible` share the same full index range:
      // `canvas2d.ts`'s edge loop already skips roots (`parent[i] === -1`)
      // on its own, so passing root indices through here costs nothing.
      const allIndices: Uint32Array = Uint32Array.from({ length: n }, (_, i) => i)
      const frame: Frame = {
        boxes: data.boxes,
        parent: data.parent,
        visible: allIndices,
        visibleCount: n,
        edges: allIndices,
        edgeCount: n,
        labels: data.labels,
        camera: { x: EXPORT_PADDING - data.bounds.minX, y: EXPORT_PADDING - data.bounds.minY, k: 1 },
        dpr: scale,
        tier: 'full',
        // Straight from `buildExportData`, which mirrored the engine's own
        // layout decisions — so the PNG path draws the same shapes, the same
        // connectors and the same branch colours the canvas does.
        edgeStyle: data.edgeStyle,
        sectors: data.sectors,
        angles: data.angles,
        labelSpace: data.labelSpace,
        hasHidden: data.hasHidden,
        branchOf: data.branchOf,
        branchDepth: data.branchDepth,
        horizontal: data.horizontal,
        rtl: data.rtl,
        // Neither highlight nor selection: an export is a picture of the
        // CHART, and both of those are states of the person looking at it.
        // A PNG that arrives with someone else's selection outlined on it is
        // a picture of their afternoon, not of the org.
        highlight: null,
        selected: null,
        dragIndex: -1,
        // An export is a picture of the CHART; a drop preview is a picture of
        // what someone is in the middle of doing to it. Same reasoning as
        // highlight and selection, a few lines up.
        dropIndex: -1,
        dropMode: 'into',
        dropValid: true,
        revealAlpha: null,
        ghostBoxes: EMPTY_GHOST_BOXES,
        ghostAlpha: EMPTY_GHOST_ALPHA,
        ghostCount: 0,
        ringActive: false,
        ringBox: INERT_RING_BOX,
        ringProgress: 0,
      }
      renderer.draw(frame)
      return surface.convertToBlob({ type: opts.format === 'jpeg' ? 'image/jpeg' : 'image/png' })
    },
    print() {
      const svg = coreToSVG(buildExportData())
      const doc = `<!DOCTYPE html><html><head><title>Org Chart</title><style>html,body{margin:0;padding:0}</style></head><body>${svg}</body></html>`
      const iframe = document.createElement('iframe')
      iframe.setAttribute('aria-hidden', 'true')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      const cleanup = (): void => {
        iframe.remove()
      }
      iframe.addEventListener(
        'load',
        () => {
          const win = iframe.contentWindow
          if (win === null) {
            cleanup()
            return
          }
          win.addEventListener('afterprint', cleanup, { once: true })
          win.focus()
          win.print()
        },
        { once: true },
      )
      document.body.appendChild(iframe)
      iframe.srcdoc = doc
    },
    setMinimap(minimap) {
      currentOptions = { ...currentOptions, minimap }
      setupMinimap()
      scheduleFrame()
    },
    setTheme(partial) {
      // Merges over the CURRENT (already-resolved) theme, not the built-in
      // defaults — passing `theme` as `resolveTheme`'s `base` is what keeps
      // every earlier `setTheme` call's tokens in place instead of resetting
      // them each time a new one comes in.
      theme = resolveTheme(partial, theme)
      currentOptions = { ...currentOptions, theme }
      chartHost.setTheme(theme)
      scheduleFrame()
    },
    setLayoutOptions(settings, opts) {
      currentOptions = { ...currentOptions, ...settings }
      chartHost.setOptions({
        spacingX: currentOptions.spacing?.x ?? 16,
        spacingY: currentOptions.spacing?.y ?? 48,
        orientation: currentOptions.orientation ?? 'tb',
        rtl: currentOptions.rtl ?? false,
        layout: currentOptions.layout ?? 'tidy',
        layoutStep: currentOptions.layoutStep,
        rowGap: currentOptions.rowGap,
        maxRings: currentOptions.maxRings,
        colourBranches: currentOptions.colourBranches,
      })
      // The tree's SHAPE changed, so anything derived from the old geometry is
      // stale: the minimap's silhouette is painted per relayout, and the
      // screen-reader mirror describes positions.
      minimapNeedsRefit = true
      a11yDirty = true
      // Queued, not called: `fit()` reads the bounds this layer last saw,
      // and the relayout that will change them has not run yet. The frame
      // loop fits once it has — the same mechanism `isolate` uses.
      if (opts?.fit === true) pendingFullFit = true
      scheduleFrame()
    },
    setRing(enabled) {
      // Every genuine single-toggle call site reads `currentOptions.ring`
      // live at the moment it toggles (see `setOpenFlag`/`expand`/`collapse`
      // above) — mutating just this key, the same way `setMinimap` mutates
      // just `minimap`, is enough; there is no separate engine-side state to
      // push, since the ring is armed per-call through `ChartHost.setOpen`'s
      // own `ring` argument, not a standing engine option.
      currentOptions = { ...currentOptions, ring: enabled }
    },
    getState,
    getView() {
      const openIds: string[] = []
      for (let i = 0; i < tree.count; i++) {
        if (open[i] === 1) openIds.push(tree.indexToId[i]!)
      }
      // Copies, not the live arrays: a view is a snapshot, and one that
      // changed under its holder as the chart moved would be a bug that only
      // shows up in whoever stored it.
      return {
        camera: { ...camera },
        open: openIds,
        highlighted: highlightedIds === null ? null : [...highlightedIds],
        isolated: isolatedIndex === -1 ? null : (tree.indexToId[isolatedIndex] ?? null),
        selected: [...selectedIds],
      }
    },
    setView(view, opts) {
      // Isolation first of all: it decides which nodes exist, and the open
      // flags and camera below are both statements about a tree that has to
      // already be the right one. `?? null` so a view saved before this field
      // existed restores the whole tree rather than nothing.
      api.isolate(view.isolated ?? null)
      // A restored view says where the camera goes; the fit that isolating
      // schedules would arrive somewhere else entirely.
      pendingFullFit = false
      // Open state first: the camera is meaningless against a layout that has
      // not happened yet, and expanding changes where everything is.
      const wanted = new Set(view.open)
      for (let i = 0; i < tree.count; i++) {
        const next: 0 | 1 = wanted.has(tree.indexToId[i]!) ? 1 : 0
        if (open[i] === next) continue
        open[i] = next
        // No ring on any of these: a restored view is not a toggle the viewer
        // performed, and a chart that flashes once per changed branch on
        // arrival is exactly the strobe the ring exists to avoid.
        chartHost.setOpen(i, next === 1, false)
      }
      a11yDirty = true

      // Ids that have since left the tree are dropped rather than throwing —
      // see `ChartView`. `highlight` already ignores unknown ids, so this only
      // has to preserve `null` as "nothing lit".
      applySelection(view.selected ?? [])
      const wantedHighlight = view.highlighted
      api.highlight(wantedHighlight === undefined || wantedHighlight === null ? null : [...wantedHighlight])

      if (opts?.animate === true) animateTo({ ...view.camera })
      else setCameraInstant({ ...view.camera })
      scheduleFrame()
    },
  }

  // Created here, after `api`, because both call back into it.
  overlay = createOverlay(overlayRoot, {
    render(element, item) {
      element.style.pointerEvents = 'auto'
      currentOptions.renderNode?.(element, {
        id: item.id,
        item: itemFor(item.index),
        open: open[item.index] === 1,
        hasChildren: canHaveChildren(item.index),
        loading: loadingIds.has(item.id),
        toggle: () => (open[item.index] === 1 ? api.collapse(item.id) : api.expand(item.id)),
        ...statsOf(item.index),
      })
    },
  })

  // Created here, after `api`, for the same reason as `overlay`: its `onFocus`
  // callback calls `api.focus`.
  a11y = createA11yTree(host, {
    onActivate(id) {
      const index = tree.idToIndex.get(id)
      if (index === undefined) return
      if (open[index] === 1) setOpenFlag(index, false)
      else requestOpen(index)
    },
    onFocus(id) {
      api.focus(id)
    },
    /**
     * The keyboard's whole drag-and-drop: `m` to pick up, `m` again over a
     * target to drop it in. Goes through the same `nodeDrop` event and the
     * same refusal rule as the pointer — a move made with the keyboard is not
     * a different kind of move, and a host that had to handle two would
     * eventually handle one of them wrong.
     */
    onMove(id, to) {
      if (to === null) return 'cancelled'
      if (currentOptions.dragAndDrop !== true) return 'refused'
      const from = tree.idToIndex.get(id)
      const target = tree.idToIndex.get(to)
      if (from === undefined || target === undefined) return 'refused'
      if (!isDropAllowed(subtreeMask(tree, [from]), target)) return 'refused'

      emitDrop([id], target, 'into')

      // Read the result rather than assume it: `emitDrop` applies the move
      // only if the `nodeDrop` handler did not refuse it, and a refusal is a
      // legitimate answer the announcement has to reflect. `tree` is rebuilt
      // on a real move, so both lookups are against the new one — the node
      // now having `to` as its parent IS the observable difference.
      const moved = tree.idToIndex.get(id)
      const landed = tree.idToIndex.get(to)
      return moved !== undefined && landed !== undefined && tree.parent[moved] === landed
        ? 'moved'
        : 'refused'
    },
  })

  rebuildItemIndex()
  syncAnimate()
  initOpen()
  applyData()
  setupMinimap()
  resize()
  queueMicrotask(() => emit('ready'))

  return {
    api,
    destroy() {
      destroyed = true
      cancelCameraAnimation()
      observer.disconnect()
      detachInput()
      dragGhost.destroy()
      stopEdgePan()
      cancelSpring()
      detachKeys()
      detachMarquee()
      overlay?.destroy()
      a11y?.destroy()
      minimap?.destroy()
      chartHost.destroy()
      canvas.remove()
      overlayRoot.remove()
      stateListeners.clear()
      eventListeners.clear()
    },
    update(data, partial) {
      currentOptions = { ...currentOptions, ...partial, data }
      // A new dataset. What was fetched belonged to the old one — its parents
      // may not even be here any more — and keeping it would graft the
      // previous tree's branches onto this one. `refresh()` is the call that
      // keeps them, because it is the call that says the data did not change.
      loadedChildren.clear()
      loadingIds.clear()
      tree = normalize(treeSource())
      stats = computeSubtreeStats(tree)
      rebuildItemIndex()
      syncAnimate()
      initOpen()
      // A pending/active anchor or full-fit names an index or relies on state
      // from the tree that just got replaced; a reload invalidates all of it.
      pendingAnchor = null
      cameraAnchor = null
      pendingFullFit = false
      pendingFocus = null
      applyData()
      setupMinimap()
      scheduleFrame()
    },
    subscribe(callback) {
      stateListeners.add(callback)
      return () => stateListeners.delete(callback)
    },
    on(event, callback) {
      const set = eventListeners.get(event) ?? new Set()
      set.add(callback as (payload: never) => void)
      eventListeners.set(event, set)
      return () => set.delete(callback as (payload: never) => void)
    },
  }
}

export { createOverlay } from './overlay.js'
export type { OverlayItem } from './overlay.js'
export type { MinimapOptions, MinimapPosition } from './minimap.js'

// Re-exported so a consumer never has to reach past this package into the core to
// name the shapes it already receives.
export type {
  Bounds,
  Camera,
  LayoutName,
  LodThresholds,
  NodeData,
  Orientation,
  Size,
  Theme,
  Warning,
  ZoomLimits,
} from '@klad/engine'

// The two ready-made palettes, for the same reason: a host doing light/dark
// should not have to derive a dark theme by hand, nor reach into core for it.
export { DARK_THEME, DEFAULT_THEME } from '@klad/engine'

// The validated categorical palette the branch-coloured layouts draw from, so
// a host can extend or replace it without reaching into core — see
// `Options.colourBranches` and `Theme.palette`.
export { DARK_PALETTE, DEFAULT_PALETTE } from '@klad/engine'
