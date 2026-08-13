import { DEFAULT_THEME, type LayoutName, type MinimapPosition, type Options, type Theme } from '@klad/core'
import { baseTheme, chartTokens, silhouetteColour, type ThemeMode } from './theme.js'

export type { LayoutName, MinimapPosition } from '@klad/core'

/**
 * Whether `example`'s own declared options already turn the minimap on —
 * the initial state the playground's minimap-toggle button should reflect
 * (and reset to) whenever a new example/stack is mounted.
 */
export function minimapDefaultOn(example: Example): boolean {
  const configured = example.options.minimap
  return configured !== undefined && configured !== false
}

/**
 * The corner `example`'s own declared minimap config already asks for —
 * the initial state the playground's position dropdown should reflect (and
 * reset to) whenever a new example/stack is mounted. Falls back to
 * `'bottom-right'`, the library's own default, for every example that
 * doesn't otherwise care (i.e. all of them except Status card, which
 * demonstrates `position: 'top-left'` as a per-instance setting).
 */
export function minimapDefaultPosition(example: Example): MinimapPosition {
  const configured = example.options.minimap
  return typeof configured === 'object' && configured.position !== undefined
    ? configured.position
    : 'bottom-right'
}

/**
 * The minimap config to use when the toggle is switched ON: the example's
 * own config (`true`, or a positioned `MinimapOptions`) if it declared one,
 * else a plain `true` — so the toggle works even on examples that don't
 * otherwise ask for a minimap, restoring the original config (position and
 * all) rather than a generic default when an example that DOES declare one
 * is switched back on.
 */
function minimapOnConfig(example: Example): NonNullable<Options['minimap']> {
  const configured = example.options.minimap
  return configured === undefined || configured === false ? true : configured
}

/**
 * The effective `minimap` option for `on`/`off`, the chosen corner and the
 * current light/dark mode, given `example`'s own config. `position` always
 * wins over whatever the example itself declared — it is the playground's own
 * dropdown control, and the point of the control is that the viewer can move
 * the widget regardless of what an individual example happened to configure.
 *
 * The silhouette colour comes from `mode` because it is the one part of the
 * widget the host's own CSS cannot reach — see `silhouetteColour` in
 * theme.ts.
 */
export function minimapOptionFor(
  example: Example,
  on: boolean,
  position: MinimapPosition,
  mode: ThemeMode,
): NonNullable<Options['minimap']> {
  if (!on) return false
  const silhouette = silhouetteColour(mode)
  const configured = minimapOnConfig(example)
  // The default 200x140 is a corner of a desktop chart and more than half the
  // width of a phone one, where it stops being an overview and becomes a
  // second chart sitting on top of the first. Scaled to the viewport, with a
  // floor so it does not shrink into something unreadable.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640
  const small = narrow ? { width: Math.max(112, Math.round(window.innerWidth * 0.34)), height: 84 } : {}
  return typeof configured === 'object'
    ? { ...configured, ...small, position, silhouetteColour: silhouette }
    : { ...small, position, silhouetteColour: silhouette }
}

/** Slider bounds and default for the "Line width" control. `EDGE_WIDTH_DEFAULT`
 * is the library's own `DEFAULT_THEME.edgeWidth`. */
export const EDGE_WIDTH_MIN = 0.5
export const EDGE_WIDTH_MAX = 6
export const EDGE_WIDTH_STEP = 0.5
export const EDGE_WIDTH_DEFAULT = 1

/**
 * How heavy a highlighted path's connectors are for a given ordinary edge
 * width. A route drawn at the same weight as everything else stops reading as
 * a route, and a fixed extra (rather than a multiplier) keeps that true at
 * both ends of the slider: +1.5px is decisive against a hairline and still
 * proportionate against a thick one, where a multiplier would run away.
 */
export function highlightWidthFor(edgeWidth: number): number {
  return edgeWidth + 1.5
}

/** Slider bounds and default for the "Edge radius" control — see `themeFor`. */
export const EDGE_RADIUS_MIN = 0
export const EDGE_RADIUS_MAX = 24
export const EDGE_RADIUS_DEFAULT = 0

/**
 * The initial swatch value for the "Node fill" control — the fill the chart
 * ACTUALLY starts with in `mode` (see theme.ts), not each example's own
 * effective value: an example that declares its own `nodeFill` for a reason
 * (Avatar/Monogram's transparent node box, so only the circle+name paint)
 * keeps it on first mount, untouched, until a viewer actually drags this
 * control — see `setNodeFill` in vanilla-demo.ts/VueDemo.vue/ReactDemo.tsx,
 * which goes straight through `api.setTheme({ nodeFill })`.
 *
 * It is mode-dependent because the swatch has to be honest: in dark mode the
 * chart's nodes are not white, and a picker sitting on `#ffffff` while the
 * chart shows near-black boxes reads as a broken control.
 */
export function nodeFillDefault(mode: ThemeMode): string {
  return chartTokens(mode).nodeFill ?? DEFAULT_THEME.nodeFill
}

/**
 * The swatch value the "Shape fill" colour picker SEEDS with once a viewer
 * turns it on — not the library's own `block`-tier default, which is
 * `'transparent'` (`DEFAULT_THEME.blockFill` in
 * packages/engine/src/render/theme.ts), not a colour at all. The picker
 * control (an `<input type="color">`) can't represent "no colour" itself, so
 * it needs SOME starting hex value ready for the moment a viewer flips the
 * "shape fill" checkbox on; this is that seed, distinct from the mode's own
 * node fill so the two swatches are visually distinguishable at a glance.
 */
export const BLOCK_FILL_SEED = '#e2e8f0'

/**
 * The initial swatch value for the "Ring colour" control — the library's own
 * default (`DEFAULT_THEME.ringStroke` in packages/engine/src/render/theme.ts),
 * same convention as `nodeFillDefault` above.
 */
export const RING_STROKE_DEFAULT = '#f59e0b'

/**
 * The effective `theme` for `example` in `mode`, with `edgeCornerRadius` set
 * from the playground's own slider.
 *
 * Layered rather than replaced, innermost-wins: the mode's own palette (node
 * fill/stroke, corner radius, connector and label colours — see theme.ts)
 * underneath, then the example's own declared theme over it, so examples that
 * set tokens for their own reasons — Avatar circle's transparent node box,
 * for instance — keep them in either mode, then the slider's one token last.
 *
 * `blockFill`/`ringStroke` deliberately have NO equivalent parameter here —
 * see `nodeFillDefault`'s docblock for why those controls never touch
 * construction-time options at all, live-only via `api.setTheme`.
 */
export function themeFor(
  example: Example,
  layout: LayoutName,
  edgeCornerRadius: number,
  mode: ThemeMode,
): NonNullable<Options['theme']> {
  return {
    ...chartTokens(mode),
    ...LAYOUT_PRESETS[layout]!.theme,
    edgeCornerRadius,
    // The example's own theme LAST, so an example that has an opinion about
    // the elbow radius keeps it at mount — the slider is a control over
    // whatever the chart starts with, not a value every example has to accept.
    // Dragging it still wins immediately: that goes through `api.setTheme`,
    // which merges over the live theme (see each demo's `setTheme`), and the
    // sidebar re-reads its own position from `effectiveTheme` on every example
    // switch, so the two never disagree about what is on screen.
    ...example.options.theme,
  }
}

/**
 * What the chart is ACTUALLY drawing with: the mode's palette, the example's
 * own theme over it, then whatever the sidebar has applied on top. Every
 * appearance control reads its current value out of this rather than
 * remembering one of its own, so a control cannot drift out of step with the
 * chart — switching example, stack or mode re-syncs all of them from one call.
 */
export function effectiveTheme(
  example: Example,
  layout: LayoutName,
  mode: ThemeMode,
  applied: Partial<Theme>,
): Theme {
  return { ...baseTheme(mode), ...LAYOUT_PRESETS[layout]!.theme, ...example.options.theme, ...applied }
}

/**
 * The theme tokens to push into an ALREADY-MOUNTED chart when the viewer flips
 * light/dark — the same layering as `themeFor`, minus the slider's token,
 * which the sidebar owns and must not be reset by a theme flip. Sent through
 * `api.setTheme` (see each demo's `setMode`), so switching mode never touches
 * camera, expand/collapse or highlight state.
 */
export function modeThemeFor(
  example: Example,
  layout: LayoutName,
  mode: ThemeMode,
): NonNullable<Options['theme']> {
  return { ...chartTokens(mode), ...LAYOUT_PRESETS[layout]!.theme, ...example.options.theme }
}

/** Options for the minimap-corner `<select>`, in on-screen order. */
export const MINIMAP_POSITIONS: { value: MinimapPosition; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

/**
 * `NodeData` itself is not re-exported from `@klad/core`'s public
 * surface (only the interfaces that reference it are). Deriving the item
 * type from `Options['data'][number]` gets the same structural type —
 * `{ id: string; parentId?: string | null; [key: string]: unknown }` —
 * without needing that name.
 */
export type NodeItem = Options['data'][number]

/**
 * Departments used by the status-card and avatar-card examples to give the
 * chart a second dimension of meaning beyond hierarchy. A node inherits its
 * manager's department (a subtree is "the same org"), except for the CEO's
 * direct reports, who each found a new one — so colour reads as a coherent
 * grouping when you scan the tree, not noise.
 */
export const DEPARTMENTS = [
  'Engineering',
  'Design',
  'Product',
  'Sales',
  'Marketing',
  'Finance',
  'Support',
] as const
export type Department = (typeof DEPARTMENTS)[number] | 'Executive'

/** Accent colour per department, shared by every custom card so the same department always reads the same colour. */
export const DEPARTMENT_COLOR: Record<Department, string> = {
  Executive: '#475569',
  Engineering: '#2563eb',
  Design: '#7c3aed',
  Product: '#0891b2',
  Sales: '#16a34a',
  Marketing: '#ea580c',
  Finance: '#0d9488',
  Support: '#db2777',
}

/**
 * The showcase example's palette — vivid enough to carry a connector at a
 * couple of pixels wide, and legible on both the light and the dark surface.
 *
 * Shared by the chart and the cards on purpose: the chart paints each branch's
 * connectors from `theme.palette` (see `Theme.edgeBranchColours`), and a card
 * that picked its accent from anywhere else would be a second, disagreeing
 * answer to "which branch is this".
 */
export const SLOT_PALETTE = ['#6366f1', '#06b6d4', '#f43f5e', '#f59e0b', '#22c55e', '#a855f7'] as const

/**
 * Which of `SLOT_PALETTE` a node belongs to: the index of the ROOT-LEVEL
 * ancestor it hangs off, which is exactly how the engine assigns branch
 * colours. The root itself has no branch and takes `null`.
 */
export function slotBranchColour(data: NodeItem[], id: string): string | null {
  const parentOf = new Map(data.map((item) => [String(item.id), item.parentId]))
  const roots = data.filter((item) => item.parentId === undefined).map((item) => String(item.id))
  const topLevel = data
    .filter((item) => item.parentId !== undefined && roots.includes(String(item.parentId)))
    .map((item) => String(item.id))
  let at: string | undefined = id
  while (at !== undefined && !topLevel.includes(at)) {
    if (roots.includes(at)) return null
    at = parentOf.get(at) === undefined ? undefined : String(parentOf.get(at))
  }
  if (at === undefined) return null
  const slot = topLevel.indexOf(at)
  return SLOT_PALETTE[slot % SLOT_PALETTE.length]!
}

/**
 * One glyph per department, for the showcase card's icon tile. Text rather than
 * an image for the same reason the avatars are initials: a playground that
 * needed the network to draw a node would be teaching the wrong lesson.
 */
export const DEPARTMENT_GLYPH: Record<Department, string> = {
  Executive: '◆',
  Engineering: '⌘',
  Design: '✎',
  Product: '◈',
  Sales: '↗',
  Marketing: '◎',
  Finance: '∑',
  Support: '☂',
}

/** "Person 3" -> "P3", "CEO" -> "CE". No network imagery needed — initials are the avatar. */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/**
 * How many direct reports a manager gets, given the running node counter, its
 * own id, and its depth (the root is depth 0). Plugged into {@link buildOrg}
 * so different examples can ask for different tree shapes out of the same
 * generator.
 */
type FanOut = (counter: number, parentId: string, depth: number) => number

/**
 * Fan-out varies per manager. A uniform six-wide tree is pathologically wide —
 * 200 nodes comes out ~30,000px across — and looks nothing like a real chart.
 * Averages 3 children (2, 3 or 4), which is what every example except Large
 * uses — a wide-ish tree that stays shallow, appropriate at a few hundred
 * nodes where you only ever see a vertical slice of it anyway.
 */
const wideFanOut: FanOut = (counter, parentId) => 2 + ((counter * 7 + parentId.length) % 3)

/**
 * Fan-out for the Large example. The naive fix — just lower the average
 * branching factor everywhere, e.g. always 2 — turns out not to work: with
 * every manager guaranteed at least one report, *any* branching factor above
 * 1 still compounds every level, so by the time the 20,000-node cap is hit,
 * almost the entire budget still lands on the last level or two (measured:
 * average-2 branching gives a tree about 18 levels deep whose widest level
 * is still ~7,000 nodes — a silhouette ratio of ~1000:1, barely better than
 * the original ~3700:1 and still well under a pixel tall in the minimap's
 * 200x140 box). Getting an actually-readable silhouette means keeping the
 * tree's widest level small for its *entire* remaining depth, not just
 * arriving there more slowly.
 *
 * So this splits growth into two regimes instead: the first `CROWN_DEPTH`
 * levels branch exactly like every other example (`wideFanOut`, 2-4 reports)
 * — a normal-looking top of the chart — and every level below that gives each
 * manager exactly one report: a long single-file reporting chain, holding the
 * tree's width fixed at whatever the crown produced (a couple hundred nodes)
 * for roughly its next 120 levels. At 20,000 nodes that comes out about 127
 * levels deep with a peak width around 160 nodes — a silhouette ratio near
 * 4:1 (versus the old ~3700:1), tall enough in the minimap to read as a real
 * vertical shape rather than a hairline. See `largeData()` below.
 */
const CROWN_DEPTH = 5
const narrowFanOut: FanOut = (counter, parentId, depth) =>
  depth < CROWN_DEPTH ? wideFanOut(counter, parentId, depth) : 1

/** Builds a branching org chart of roughly `target` nodes, using `fanOut` to decide reports-per-manager. */
export function buildOrg(target: number, fanOut: FanOut = wideFanOut): NodeItem[] {
  const data: NodeItem[] = []
  const departmentById = new Map<string, Department>()
  const childCount = new Map<string, number>()

  function push(
    id: string,
    parentId: string | undefined,
    name: string,
    title: string,
    department: Department,
  ): void {
    departmentById.set(id, department)
    if (parentId !== undefined) childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1)
    data.push({
      id,
      ...(parentId !== undefined ? { parentId } : {}),
      name,
      title,
      department,
    })
  }

  push('ceo', undefined, 'CEO', 'Chief Executive', 'Executive')
  let frontier = ['ceo']
  let counter = 0
  let depth = 0
  while (data.length < target) {
    const next: string[] = []
    for (const parentId of frontier) {
      const reports = fanOut(counter, parentId, depth)
      for (let i = 0; i < reports && data.length < target; i++) {
        const id = `n${counter++}`
        const department =
          parentId === 'ceo' ? DEPARTMENTS[counter % DEPARTMENTS.length]! : departmentById.get(parentId)!
        push(id, parentId, `Person ${counter}`, `Role ${i}`, department)
        next.push(id)
      }
    }
    frontier = next
    depth++
  }

  // Second pass: headcount (direct reports) is only known once every child has
  // been pushed, so it can't be set inside `push` above.
  for (const item of data) {
    item.headcount = childCount.get(String(item.id)) ?? 0
  }

  return data
}

/**
 * Which node-content treatment an example wants. Both demos switch on this
 * (vanilla picks a render function, Vue picks a template branch) so adding an
 * example is still one registry entry — the two rendering paths just have to
 * agree on what each tag looks like.
 *
 * - 'card'     — the original name/title card (default look).
 * - 'avatar'   — circular initials monogram + name + role.
 * - 'monogram' — a round, department-ringed initials avatar with the name
 *   below it (not beside it) — taller than it is wide, clickable.
 * - 'status'   — department-coloured accent + department/headcount badges.
 * - 'photo'    — squarer, image-dominant tile (CSS-gradient "photo" + initials).
 * - 'none'     — no overlay content at all: canvas-only, frameworkless cost.
 */
export type NodeContentKind =
  | 'row'
  | 'card'
  | 'avatar'
  | 'monogram'
  | 'status'
  | 'photo'
  | 'counts'
  | 'bounds'
  | 'dropdown'
  | 'accordion'
  | 'actions'
  | 'slot'
  | 'none'

export interface Example {
  id: string
  name: string
  /** One line, shown on the page under the controls. */
  description: string
  data: NodeItem[]
  /** Merged over the demo's own defaults (nodeSize, label, renderNode/slot). */
  options: Partial<Options>
  /** Which node-content treatment to render; see {@link NodeContentKind}. */
  content: NodeContentKind
  /**
   * Shows the sidebar's "Go to node" combo box for this example. Deliberately
   * a per-example opt-in rather than a control that is always there: it is the
   * point of exactly one example, and a chart-wide control that only means
   * something on one of them is worse than no control.
   */
  gotoControl?: boolean
  /**
   * Shows the orientation panel on the canvas: the four growth directions as a
   * segmented control, plus an RTL switch beside them.
   *
   * The two used to be separate examples — one frozen at `lr`, one at
   * `tb + rtl` — which showed two of the eight arrangements and left the
   * relationship between the options unstated. They are one control because
   * they are one question ("which way does this read?") answered on two
   * independent axes: `orientation` turns the growth axis, `rtl` mirrors
   * sibling order across it, and neither cancels the other (see
   * `applyOrientation` in core).
   */
  orientationControl?: boolean
  /**
   * Shows the "branch and view" panel on the canvas: a branch picker wired to
   * `fitSubtree`, and save/restore buttons for `getView`/`setView`. Same
   * per-example opt-in as `gotoControl`, for the same reason — these belong to
   * the one example that is about them.
   */
  viewControl?: boolean
  /**
   * Shows the selection panel: what is selected right now, and the two
   * commands (select every visible node, clear) that an app would build on
   * top of a selection. Per-example, like the others.
   */
  selectionControl?: boolean
  /**
   * Shows the drop log: what the last drag actually moved, and where. Same
   * per-example opt-in as the others — a chart-wide panel that only reports on
   * one example would be worse than none.
   */
  dropControl?: boolean
  /**
   * Shows the filter box, and the count of what it matched. Per-example like
   * the others: a search field on a chart of eight nodes teaches nothing.
   */
  filterControl?: boolean
  /**
   * Shows the editing panel — add, remove, and a button that pretends a poll
   * came back. The three things `move`/`add`/`remove` and `reconcile` do that
   * a screenshot cannot show.
   */
  editControl?: boolean
  /**
   * Lights the path from the root to whatever the pointer is over, using
   * `highlight` + `pathTo` — see each demo's `nodeHover` wiring. Per-example
   * like the other controls: a chart where every hover repaints a route is a
   * showcase, not a default, and the examples about something else should
   * stay quiet under the pointer.
   */
  hoverTrail?: boolean
  /**
   * Readable source for this example's function options, by option name.
   *
   * The code panel prints a function with `toString()`, which in a production
   * build hands back the MINIFIED body — `(o,t)=>{let n=Ou(String(t.id))...}`
   * where the reader wanted a predicate they could copy. That affects exactly
   * the options worth reading: `canMove`, `edgeFlow`, `mayHaveChildren`,
   * `pinChildren`, `collapsedByDefault`.
   *
   * So an example says what its own snippet should read, and the panel prefers
   * that. What it must not do is drift from the real option beside it — the
   * two are written together here for that reason.
   */
  source?: Record<string, string>
}

// Shared by every example except "Large", which needs its own scale and its
// own lazily-built dataset (see below) so switching to one of the small
// examples never pays the cost of building the 20k-node tree.
// Small enough that the whole chart is comprehensible at 1:1. A few hundred nodes
// is realistic but spreads subtrees thousands of pixels apart, so you only ever see
// a vertical slice of it — which is what the Large example is for.
/**
 * The org every example draws unless it says otherwise. Exported because a
 * custom card sometimes has to ask something about the TREE rather than about
 * its own node — `slotBranchColour` walks to the branch root to find which
 * colour the chart is painting that branch in.
 */
export const SHARED_DATA = buildOrg(28)

/**
 * Which department everybody is in, for the Editing example's `canMove`.
 *
 * A map rather than a look through `data`, because `canMove` is asked while
 * the pointer is moving and a scan per ask is the thing its docblock warns
 * about. Mutable so a person the demo ADDS is answerable too — the rule has
 * to hold for rows that were not in the array this was built from.
 */
const ORG_DEPARTMENT = new Map(SHARED_DATA.map((item) => [String(item.id), item.department as Department]))

/**
 * Who each person currently reports to, for the rule above — so it can tell a
 * reorder (same parent) from a reassignment (a different one).
 *
 * Kept up to date by the demo rather than read from the chart, because
 * `canMove` is asked mid-drag and reaching back into the chart from an option
 * it is calling is a loop waiting to happen.
 */
const EXAMPLE_PARENT = new Map(
  SHARED_DATA.filter((item) => item.parentId !== undefined).map((item) => [
    String(item.id),
    String(item.parentId),
  ]),
)

/** Records where somebody now sits, so the reorder rule stays true after a move. */
export function rememberParent(id: string, parentId: string | null): void {
  if (parentId === null) EXAMPLE_PARENT.delete(id)
  else EXAMPLE_PARENT.set(id, parentId)
}

/** Files a newly added person under a department, so `canMove` can answer for them. */
export function rememberDepartment(id: string, department: Department): void {
  ORG_DEPARTMENT.set(id, department)
}

/** What department a node is in, or `null` for one nobody has filed. */
export function departmentOf(id: string): Department | null {
  return ORG_DEPARTMENT.get(id) ?? null
}

/** Big enough that finding somebody by eye is not an option, which is the
 * situation a filter is for. */
const FILTER_DATA = buildOrg(600)

/**
 * The accordion example's two node heights, and how far a given card is
 * between them. `detailT` is eased from 0 to 1 by the demo (see
 * `renderAccordion` in vanilla-demo.ts) rather than flipped, so the node
 * slides open instead of jumping — `nodeSize` is read at layout time, so
 * animating the SIZE means animating the number `nodeSize` returns and
 * re-measuring as it changes.
 */
export const ACCORDION_CLOSED_H = 72
export const ACCORDION_OPEN_H = 132

export function accordionProgress(item: NodeItem): number {
  const t = Number(item.detailT ?? 0)
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
}

const SIZE_VARIANTS = [
  { w: 140, h: 56 },
  { w: 200, h: 72 },
  { w: 170, h: 96 },
]

let largeDataCache: NodeItem[] | null = null
function largeData(): NodeItem[] {
  largeDataCache ??= buildOrg(20_000, narrowFanOut)
  return largeDataCache
}

// ---------------------------------------------------------------------------
// A source tree, for the three layouts that are about something other than an
// org chart.
//
// The org data every other example shares is the wrong shape for these: a
// generated hierarchy of "Person 41" reporting to "Person 12" tells you nothing
// about whether a file explorer looks right, and a sunburst of it is a wheel of
// interchangeable names. A directory tree has what these layouts are for — real
// nesting depth, wildly uneven branch sizes, and leaves that carry a magnitude
// (bytes) the geometry can be read against.
// ---------------------------------------------------------------------------

/** One directory's contents, as `[name, children]` or a leaf `[name, sizeKb]`. */
type FileSpec = [string, FileSpec[] | number]

const PROJECT: FileSpec[] = [
  [
    'src',
    [
      [
        'components',
        [
          ['Button.tsx', 14],
          ['Card.tsx', 22],
          ['Dialog.tsx', 41],
          ['Table.tsx', 68],
          ['Toolbar.tsx', 19],
        ],
      ],
      [
        'hooks',
        [
          ['useChart.ts', 31],
          ['useTheme.ts', 9],
          ['useViewport.ts', 17],
        ],
      ],
      [
        'lib',
        [
          [
            'render',
            [
              ['canvas.ts', 112],
              ['svg.ts', 87],
              ['palette.ts', 24],
            ],
          ],
          [
            'layout',
            [
              ['tidy.ts', 96],
              ['radial.ts', 38],
              ['sunburst.ts', 44],
            ],
          ],
          ['tree.ts', 53],
          ['viewport.ts', 28],
        ],
      ],
      ['index.ts', 6],
      ['main.tsx', 11],
    ],
  ],
  [
    'tests',
    [
      ['layout.test.ts', 64],
      ['render.test.ts', 78],
      ['tree.test.ts', 33],
      [
        'fixtures',
        [
          ['small.json', 4],
          ['large.json', 210],
        ],
      ],
    ],
  ],
  [
    'docs',
    [
      ['getting-started.md', 12],
      ['api.md', 46],
      ['roadmap.md', 8],
    ],
  ],
  [
    'public',
    [
      ['favicon.svg', 2],
      ['logo.svg', 5],
    ],
  ],
  ['package.json', 3],
  ['tsconfig.json', 2],
  ['README.md', 9],
]

/**
 * Flattens {@link PROJECT} into the flat `{ id, parentId, ... }` rows Klad
 * takes. Each node carries `kind` (folder or file) and `sizeKb` — a folder's
 * size being the sum of its contents, which is what makes the sunburst's
 * segments mean something rather than just being equal slices.
 */
function buildFileTree(): NodeItem[] {
  const rows: NodeItem[] = []
  rows.push({ id: 'root', name: 'my-project', kind: 'folder', sizeKb: 0, ext: '' })

  const walk = (specs: FileSpec[], parentId: string, path: string): number => {
    let total = 0
    for (const [name, contents] of specs) {
      const id = `${path}/${name}`
      if (typeof contents === 'number') {
        rows.push({ id, parentId, name, kind: 'file', sizeKb: contents, ext: name.split('.').pop() ?? '' })
        total += contents
        continue
      }
      // Pushed before its children are walked so the row order stays preorder
      // — which is the order a file explorer lists them in — then patched with
      // the total once they are known.
      const row: NodeItem = { id, parentId, name, kind: 'folder', sizeKb: 0, ext: '' }
      rows.push(row)
      const size = walk(contents, id, id)
      row.sizeKb = size
      total += size
    }
    return total
  }

  const rootRow = rows[0]!
  rootRow.sizeKb = walk(PROJECT, 'root', '')
  return rows
}

// --- "Children on demand": a tree that is not in the page ------------------
//
// Every other example ships its whole dataset. This one ships four rows and
// fetches the rest, because that is the only way to demonstrate a feature
// whose entire point is a tree the page does not have. The "server" below is
// a plain function with a delay in it; in an app it is your API.

/** Names the fake server hands out, so a fetched folder looks like a folder
 * rather than a row of `node-3-1`. */
const REMOTE_FOLDERS = [
  'assets',
  'components',
  'config',
  'docs',
  'hooks',
  'lib',
  'modules',
  'routes',
  'schemas',
  'services',
  'shared',
  'stores',
  'tests',
  'types',
  'utils',
  'views',
  'workers',
]
const REMOTE_FILES = [
  'index.ts',
  'client.ts',
  'helpers.ts',
  'options.ts',
  'parser.ts',
  'reducer.ts',
  'schema.ts',
  'server.ts',
  'state.ts',
  'worker.ts',
]

/** Deterministic per id — the same folder opened twice gives the same
 * children, which is what an API would do and what makes the example
 * inspectable. */
function remoteHash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** How deep the fake filesystem goes. Past this, folders come back empty —
 * which the chart handles by quietly turning them into leaves, and which is
 * worth showing: `mayHaveChildren` is a guess, and this is what a wrong guess
 * looks like. */
const REMOTE_MAX_DEPTH = 6

/**
 * One directory listing. Async and slowed on purpose: a fetch that resolved
 * instantly would hide the whole loading state, which is half of what this
 * example is about.
 */
export function fetchRemoteChildren(item: NodeItem): Promise<NodeItem[]> {
  const id = String(item.id)
  const depth = id.split('/').length - 1
  const hash = remoteHash(id)
  const rows: NodeItem[] = []
  if (depth < REMOTE_MAX_DEPTH) {
    const folders = 1 + (hash % 3)
    for (let i = 0; i < folders; i++) {
      const name = REMOTE_FOLDERS[(hash + i * 7) % REMOTE_FOLDERS.length]!
      rows.push({ id: `${id}/${name}`, name, kind: 'folder', sizeKb: 0, ext: '' })
    }
  }
  const files = 2 + ((hash >>> 3) % 4)
  for (let i = 0; i < files; i++) {
    const name = REMOTE_FILES[(hash + i * 11) % REMOTE_FILES.length]!
    rows.push({
      id: `${id}/${i}-${name}`,
      name,
      kind: 'file',
      sizeKb: 1 + ((hash >>> (i + 1)) % 240),
      ext: name.split('.').pop() ?? '',
    })
  }
  return new Promise((resolve) => setTimeout(() => resolve(rows), 260 + (hash % 340)))
}

/** What the page actually has: one root and its top level. Everything below
 * arrives on demand. */
export const REMOTE_ROOTS: NodeItem[] = [
  { id: 'srv', name: 'production', kind: 'folder', sizeKb: 0, ext: '' },
  { id: 'srv/app', parentId: 'srv', name: 'app', kind: 'folder', sizeKb: 0, ext: '' },
  { id: 'srv/packages', parentId: 'srv', name: 'packages', kind: 'folder', sizeKb: 0, ext: '' },
  { id: 'srv/README.md', parentId: 'srv', name: 'README.md', kind: 'file', sizeKb: 4, ext: 'md' },
]

// --- "Very wide levels": a working set inside a crowd ----------------------
//
// Five levels of a hundred-odd, where only a handful per level matter. The
// point of the example is that a plain cap would show whichever eight sort
// first, which is nobody's eight — so it pins a working set and lets the rest
// roll up.

/**
 * The working set: the nodes this viewer is actually dealing with.
 *
 * MUTABLE and shared, deliberately. `pinChildren` closes over it and is never
 * rebuilt, so checking somebody in the picker changes what the chart draws
 * without changing the options object — which is what stops Vue's deep watch
 * and React's identity check from tearing the chart down on every change. See
 * the wide-levels guide.
 */
export const WIDE_WATCHING = new Set<string>(['l1-3', 'l2-3-4', 'l3-0-0-7'])

/**
 * How a change to the working set reaches the chart.
 *
 * Registered by whichever stack currently has one mounted; called by the
 * picker. `refresh()` re-reads `pinChildren`, which is what makes the tick
 * land on the chart — see the wide-levels guide.
 */
let onWatchingChanged: ((keep?: string) => void) | null = null

export function setWorkingSetHook(fn: ((keep?: string) => void) | null): void {
  onWatchingChanged = fn
}

/**
 * `keep` is the node the viewer is working FROM — the aggregate the picker
 * is hanging off. Ticking somebody swaps who is on that level, and without a
 * pin the level slides out from under the panel still open over it.
 */
/**
 * Parents the viewer has opened the picker on.
 *
 * Once they have, that level shows exactly what is ticked and nothing else —
 * see `WIDE_CAP`. Before they have, it shows the first few, which is what
 * makes the chart readable on arrival.
 */
export const WIDE_CURATED = new Set<string>()

/** The cap for one parent. Zero once curated: the budget would otherwise
 * refill with whoever was just unticked, so a box you cleared would tick
 * itself straight back on. */
export function wideCap(item: NodeItem): number {
  return WIDE_CURATED.has(String(item.id)) ? 0 : 3
}

/**
 * Takes over a level: pins whatever is currently on it, so the picker's boxes
 * are exactly what the chart is showing.
 *
 * Deliberately does NOT notify — the chart draws the same nodes either way, by
 * the budget before and by these pins after, so there is nothing to redraw and
 * a rebuild here would be a flicker for no reason.
 */
export function curateWide(parentId: string, showing: string[]): void {
  if (WIDE_CURATED.has(parentId)) return
  WIDE_CURATED.add(parentId)
  for (const id of showing) WIDE_WATCHING.add(id)
}

export function toggleWatching(id: string, next: boolean, keep?: string): void {
  if (next) WIDE_WATCHING.add(id)
  else WIDE_WATCHING.delete(id)
  onWatchingChanged?.(keep)
}

function buildWideTree(): NodeItem[] {
  const rows: NodeItem[] = [{ id: 'org', name: 'Everyone', kind: 'folder' }]
  const hash = (s: string): number => {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }
  // Deterministic per id, so the same node reads the same on every reload —
  // which matters here because the example is about picking specific people
  // out of a crowd, and they have to stay the same people.
  const name = (id: string): string => `Person ${hash(id) % 9973}`
  // Four levels of a hundred-odd, which is the shape this example is about —
  // and about four thousand nodes, which is not. An earlier version fanned out
  // to fifty-seven thousand and made the page crawl: the cap draws almost
  // nothing either way, but every pass that decides WHAT to draw is over the
  // whole array, so the size that matters here is the data's, not the chart's.
  for (let a = 0; a < 140; a++) {
    const l1 = `l1-${a}`
    rows.push({ id: l1, parentId: 'org', name: name(l1), role: 'Director' })
    if (a >= 24) continue
    for (let b = 0; b < 110; b++) {
      const l2 = `l2-${a}-${b}`
      rows.push({ id: l2, parentId: l1, name: name(l2), role: 'Lead' })
      if (a >= 6 || b >= 10) continue
      for (let c = 0; c < 100; c++) {
        rows.push({
          id: `l3-${a}-${b}-${c}`,
          parentId: l2,
          name: name(`l3-${a}-${b}-${c}`),
          role: 'Engineer',
        })
      }
    }
  }
  return rows
}

export const WIDE_DATA: NodeItem[] = buildWideTree()

export const FILE_DATA: NodeItem[] = buildFileTree()

/** Row height for the file-explorer example, and the width every row shares.
 * A file list is a list: uniform rows, one column, the indent doing the work. */
export const FILE_ROW = { w: 340, h: 30 }

/** Horizontal step per depth level in the file layout, and the amount each
 * row's own width shrinks by so they all end at the same x. */
export const FILE_INDENT = 18

/** The narrowest a row gets, however deep it sits — enough for a chevron, an
 * icon, a readable name and its trailing value. */
export const FILE_ROW_MIN = 190

/**
 * Node sizes for the wheel layouts. Neither draws these as cards — a radial
 * chart puts a small marker at each ring position and radiates the name out
 * from it, and a sunburst draws sectors and ignores the box entirely — so what
 * these numbers actually control is the derived ring spacing and, for radial,
 * how much room the layout reserves outside the last ring for labels. See
 * `LayoutOptions.step`.
 */
export const RADIAL_NODE = { w: 18, h: 18 }
export const SUNBURST_NODE = { w: 40, h: 40 }

// ---------------------------------------------------------------------------
// Presentation follows the LAYOUT, not the example.
//
// Every example is a tree, and all four layouts can draw any tree — so in
// principle the layout picker should be free. In practice it wasn't: each
// example carried its own node size, content treatment and theme overrides,
// and those are the things that stop making sense when the shape changes.
// File-explorer rows fanned out around a circle are nonsense. Org cards under
// a sunburst are worse than nonsense — sectors ignore the DOM overlay
// entirely, so the cards just hang over the wheel unattached to anything.
//
// So the presentation a layout REQUIRES lives here, keyed by layout, and is
// merged over whatever the example itself declared. An example then only says
// what it is ABOUT — its data, and any behaviour peculiar to it — and every
// combination of example and layout produces something worth looking at.
// Which is the library's actual claim: the same tree, drawn four ways.
// ---------------------------------------------------------------------------

export interface LayoutPreset {
  /**
   * Merged over the example's own options — so a preset wins where the two
   * disagree, which is the whole point of it.
   */
  options: Partial<Options>
  /**
   * The node-content treatment this layout needs, or `null` to keep whatever
   * the example asked for.
   *
   * `'none'` for the two wheel layouts is not an omission: they draw their own
   * text on the canvas, positioned against geometry a DOM element cannot
   * follow (turned along a spoke, laid on an arc). An overlay card there would
   * be a second, unaligned copy of the same name.
   */
  content: NodeContentKind | null
  /** Theme tokens the layout needs, merged under the example's own. */
  theme?: Partial<Theme>
  /** Shown under the layout picker as what this shape is FOR. */
  blurb: string
}

export const LAYOUT_PRESETS: Record<LayoutName, LayoutPreset> = {
  tidy: {
    options: {},
    content: null, // the example's own card — this is the 1.0 chart
    blurb: 'Tiered, the classic org chart. The only layout `orientation` applies to.',
  },
  file: {
    options: {
      // Rows END at a common right edge rather than all being the same width:
      // an indented row that keeps its full width pushes its trailing column
      // right along with it, so the sizes come out as a staircase instead of a
      // column you can scan down. Shrinking each row by its own indent is
      // what every file explorer does, and the depth comes from the second
      // argument — the preset does not have to know the dataset to size a row.
      //
      // Never below `FILE_ROW_MIN`, though. A deep tree eventually indents
      // past the point where there is any name left to show — the Large
      // example is a chain 127 levels deep, which at a bare
      // `width - depth * indent` reaches zero around level nineteen and goes
      // NEGATIVE after that: rows with no room for their own text, marching
      // off to the right. Past the floor a row simply keeps its minimum and
      // the list grows sideways, which is what a real explorer does too (and
      // is why it has a horizontal scrollbar).
      nodeSize: (_item, at) => ({
        w: Math.max(FILE_ROW_MIN, FILE_ROW.w - at.depth * FILE_INDENT),
        h: FILE_ROW.h,
      }),
      rowGap: 2,
      layoutStep: FILE_INDENT,
      // The row is a DOM element and draws its own text; the canvas underneath
      // contributes only the folder guide lines.
      label: () => '',
      toggleOnNodeClick: true,
    },
    content: 'row',
    theme: { nodeFill: 'transparent', nodeStroke: 'transparent' },
    blurb: 'One indented row per node. The only layout whose width does not grow with the tree.',
  },
  radial: {
    options: {
      nodeSize: RADIAL_NODE,
      layoutStep: 190,
      colourBranches: true,
      // Click a marker to open or close it. Not a stylistic choice: the node
      // IS an 18px dot, so there is nowhere to put a disclosure control, and
      // without this the one thing every other layout lets you do — fold a
      // branch away — is unreachable on a wheel.
      toggleOnNodeClick: true,
    },
    content: 'none',
    // A marker, not a card: the name radiating out of it carries the content,
    // which is what leaves the ring spacing free to be set by how much room
    // the NAMES need rather than by how wide a card is.
    theme: { cornerRadius: RADIAL_NODE.w / 2, nodeStroke: 'transparent' },
    blurb: 'Root at the centre, generations as rings. For trees that are wide and shallow.',
  },
  sunburst: {
    options: {
      nodeSize: SUNBURST_NODE,
      layoutStep: 74,
      maxRings: 3,
    },
    content: 'none',
    blurb: 'Nested arc segments, coloured by branch. Click a segment to drill into it.',
  },
}

/** The layout picker's own order and labels — the order they were added to
 * the library, which is also roughly least to most specialised. */
export const LAYOUT_ORDER: LayoutName[] = ['tidy', 'file', 'radial', 'sunburst']

export const LAYOUT_LABELS: Record<LayoutName, string> = {
  tidy: 'Tidy',
  file: 'File',
  radial: 'Radial',
  sunburst: 'Sunburst',
}

/**
 * What one indented row shows, for ANY of the playground's datasets.
 *
 * The `file` layout is a shape, not a subject — "one indented row per node" is
 * as true of a reporting line as of a directory — so the row that fills it has
 * to work for whatever tree the viewer picked, or half the layout picker's
 * combinations produce rows reading `undefined`. Both datasets have the same
 * three things to say: something to identify the node at a glance, its name,
 * and one number or phrase about it.
 */
export interface RowFields {
  /** A short glyph or monogram. */
  icon: string
  /** A colour for the icon chip, or `''` to leave it unstyled — a file tree's
   * emoji icons carry their own colour; an org monogram needs one. */
  iconColour: string
  primary: string
  secondary: string
}

export function rowFields(item: NodeItem, open: boolean): RowFields {
  // A directory tree announces itself with `kind`; anything else is people.
  if (item.kind === 'folder' || item.kind === 'file') {
    const kb = Number(item.sizeKb ?? 0)
    return {
      icon: item.kind === 'folder' ? (open ? '📂' : '📁') : '📄',
      iconColour: '',
      primary: String(item.name ?? item.id),
      // Sizes are stored in KB; six digits on every row is a wall of numbers
      // rather than a column you can scan.
      secondary: kb <= 0 ? '' : kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`,
    }
  }
  const department = (item.department as Department | undefined) ?? 'Executive'
  return {
    icon: initials(String(item.name ?? '')),
    iconColour: DEPARTMENT_COLOR[department],
    primary: String(item.name ?? item.id),
    secondary: String(item.title ?? ''),
  }
}

/** True for a row that should read as a container — bolder, like a folder. */
export function isBranchRow(item: NodeItem, hasChildren: boolean): boolean {
  return item.kind === 'folder' || (item.kind === undefined && hasChildren)
}

/**
 * The drop-log payload, by NAME rather than id.
 *
 * Shared by all three demos so they report a move identically — the point of
 * the playground is that the stacks are directly comparable, and a log that
 * said different things about the same drag would undercut that. The chart
 * speaks ids and the cards show names, and "n15 → into n5" about two cards
 * reading "Person 16" and "Person 6" is a puzzle rather than a confirmation.
 */
export function dropDetail(
  data: NodeItem[],
  ids: string[],
  parentId: string | null,
  mode: string,
): { ids: string[]; parentId: string | null; mode: string } {
  const nameOf = (id: string): string => String(data.find((each) => String(each.id) === id)?.name ?? id)
  return { ids: ids.map(nameOf), parentId: parentId === null ? null : nameOf(parentId), mode }
}

/** Which layout an example draws in by default. */
export function defaultLayoutOf(example: Example): LayoutName {
  return example.options.layout ?? 'tidy'
}

/**
 * The example's options as they should actually be handed to the chart, for a
 * given layout: the example's own, then the layout's preset over the top, then
 * the layout name itself.
 *
 * Deliberately preset-over-example rather than the other way round. An example
 * that declared `nodeSize: { w: 224, h: 96 }` for its avatar card means "this
 * card needs that much room", and that statement is about the CARD — under a
 * sunburst there is no card, and honouring it would only set the ring
 * thickness from a number chosen for something that isn't being drawn.
 */
export function optionsForLayout(example: Example, layout: LayoutName): Partial<Options> {
  const preset = LAYOUT_PRESETS[layout]!
  return { ...example.options, ...preset.options, layout }
}

/** The node-content treatment for an example under a given layout. */
export function contentForLayout(example: Example, layout: LayoutName): NodeContentKind {
  return LAYOUT_PRESETS[layout]!.content ?? example.content
}

/** Whether the sunburst's breadcrumb belongs on screen — a function of the
 * LAYOUT, since "what is at the centre" only means something on a wheel. */
export function centreControlFor(layout: LayoutName): boolean {
  return layout === 'sunburst'
}

export const EXAMPLES: Example[] = [
  {
    id: 'basic',
    name: 'Basic',
    description:
      'Nothing configured but the minimap — the chart you get from data alone. Every other example is this with one thing changed.',
    data: SHARED_DATA,
    options: { minimap: true },
    content: 'card',
  },
  {
    id: 'slots',
    name: 'Lit branches',
    description:
      'Every connector in the colour of the card it leads to, elbows rounded into slots, and the whole route to the root lighting up under the pointer.',
    data: SHARED_DATA,
    options: {
      nodeSize: { w: 164, h: 50 },
      colourBranches: true,
      toggleOnNodeClick: true,
      spacing: { x: 20, y: 46 },
      // Both tiers arrive earlier than the default (0.25 / 0.6): these cards
      // are wide and their text is small, so there is still something worth
      // reading at a zoom where the stock thresholds would already have
      // dropped to a label — and the diagram is at its best seen whole.
      lodThresholds: { text: 0.12, overlay: 0.34 },
      theme: {
        palette: [...SLOT_PALETTE],
        // The paper, painted by the chart itself so it cannot lag a pan — see
        // `Theme.gridDot`. A CSS background on the element was a frame behind
        // on every drag, which reads as the diagram sliding over glass.
        // A literal colour, not a `color-mix` on `currentColor`: this string
        // is handed to a canvas, which has no element to resolve either
        // against. Mid-grey at low alpha, so it sits under both surfaces.
        gridDot: 'rgba(128, 132, 148, 0.3)',
        gridSpacing: 26,
        gridDotSize: 1,
        // The connectors are the point of this example, so they are given the
        // weight of one: coloured per branch, thick enough to read as ink
        // rather than as a hairline, and bent through a radius big enough to
        // turn each elbow into the slot shape of a technical drawing.
        edgeBranchColours: true,
        edgeWidth: 1.5,
        edgeCornerRadius: 18,
        // The lit route keeps the mode's OWN highlight ink rather than a
        // colour of this example's choosing: white reads beautifully on the
        // dark surface and vanishes on the light one, and an example that
        // only works in one mode is not a showcase. What this example does
        // add is the weight and the halo.
        edgeHighlightWidth: 3,
        // Enough halo to say "this one", not enough to bloom over the diagram.
        edgeHighlightGlow: 7,
        // The lit path keeps its branch's colour and takes only the weight and
        // the halo — recolouring it would throw away the one thing the
        // connectors are saying at the moment the viewer asks about it.
        edgeHighlightRecolours: false,
        // The card carries its own "there is more inside" mark (see
        // `.slot-more`), so the chart's stub would be a second one hanging
        // into empty space.
        hiddenMark: false,
        // The cards are DOM (see `renderSlot`); what the canvas paints under
        // them is only the shape, and it has to be the same stadium the card
        // is, or the two disagree at the corners while a branch animates.
        cornerRadius: 25,
        nodeFill: 'transparent',
        nodeStroke: 'transparent',
        // Nothing is painted on a node to say it is on the route: the cards
        // are the design, and the connectors through them already say it in
        // the branch's own colour. A ring in the mode's highlight ink would be
        // a third colour arriving on a card that has two.
        highlightFill: 'transparent',
        highlightStroke: 'transparent',
      },
    },
    content: 'slot',
    hoverTrail: true,
  },
  {
    id: 'orientations',
    name: 'Orientations',
    description:
      'Which way the tree grows, and which way its siblings read. The four directions are one option; RTL is a second, and it mirrors sibling order without changing the direction of growth — so there are eight arrangements here, not four.',
    data: SHARED_DATA,
    options: { orientation: 'tb' },
    content: 'card',
    orientationControl: true,
  },
  {
    id: 'variable-sizes',
    name: 'Variable node sizes',
    description:
      'Cards of three different sizes in one chart, for data where some nodes carry more than others.',
    data: SHARED_DATA,
    options: {
      nodeSize: (item) => {
        const n = Number(String(item.id).replace(/\D/g, '')) || 0
        return SIZE_VARIANTS[n % SIZE_VARIANTS.length]!
      },
    },
    content: 'card',
  },
  {
    id: 'collapsed',
    name: 'Collapsed by default',
    description: 'Everything starts closed. Open a branch at a time, or use Expand All.',
    data: SHARED_DATA,
    options: { collapsedByDefault: true },
    content: 'card',
  },
  {
    id: 'avatar-card',
    name: 'Avatar card',
    description: 'The familiar org chart card: initials, a name and a role.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 224, h: 96 }, minimap: true },
    content: 'avatar',
  },
  {
    id: 'avatar-circle',
    name: 'Avatar circle',
    description:
      'No card at all — a floating avatar with the name under it, and the toggle sitting where the line to its reports begins. Tap the circle to open or close.',
    data: SHARED_DATA,
    options: {
      nodeSize: { w: 96, h: 108 },
      toggleOnNodeClick: true,
      label: () => '',
      theme: { nodeFill: 'transparent', nodeStroke: 'transparent' },
    },
    content: 'monogram',
  },
  {
    id: 'status-card',
    name: 'Status card',
    description:
      'Colour carrying a second meaning alongside the hierarchy: which department someone is in, and how many people report to them. Tap a card to open or close it.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 208, h: 88 }, toggleOnNodeClick: true, minimap: { position: 'top-left' } },
    content: 'status',
  },
  {
    id: 'photo-tile',
    name: 'Photo tile',
    description: 'A taller, picture-led card, for charts where the face matters more than the title.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 132, h: 156 } },
    content: 'photo',
  },
  {
    id: 'counts',
    name: 'Subtree counts',
    description:
      'Every card reporting on its own branch: direct reports, everyone below at any depth, and how deep it runs. Collapse a branch — the numbers describe the whole tree, not the part you can see.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 216, h: 96 } },
    content: 'counts',
  },
  {
    id: 'dropdown',
    name: 'Card with a dropdown',
    description:
      'A real form control living on a card. Opening it does not pan the chart, and choosing an option is not mistaken for clicking the node.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 208, h: 92 } },
    content: 'dropdown',
  },
  {
    id: 'accordion',
    name: 'Accordion detail',
    description:
      "A card with its own detail pane, opening independently of the chart's own expand and collapse — and the layout sliding out of its way as it grows.",
    data: SHARED_DATA,
    options: {
      // A function of the card's own disclosure PROGRESS, not just its open
      // flag: the demo eases that number from 0 to 1 and re-measures each
      // frame, so the node slides open instead of snapping. See
      // `ACCORDION_CLOSED_H`/`ACCORDION_OPEN_H` and `renderAccordion`.
      nodeSize: (item) => ({
        w: 232,
        h: ACCORDION_CLOSED_H + (ACCORDION_OPEN_H - ACCORDION_CLOSED_H) * accordionProgress(item),
      }),
    },
    content: 'accordion',
  },
  {
    id: 'actions',
    name: 'Custom buttons',
    description:
      'The node as a small toolbar. Star someone, or use the arrow to fly to them with the route from the top marked.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 212, h: 96 } },
    content: 'actions',
  },
  {
    id: 'goto',
    name: 'Go to node',
    description:
      'Finding someone in a chart that starts fully closed. Pick a name and the way opens, the route from the top lights up, and the camera arrives on them.',
    data: SHARED_DATA,
    options: { collapsedByDefault: true, nodeSize: { w: 200, h: 72 } },
    content: 'card',
    gotoControl: true,
  },
  {
    id: 'views',
    name: 'Branches and views',
    description:
      'Three ways to deal with a chart bigger than the screen: frame one branch, show one branch as if it were the whole chart, or save where you are and come back to it later. Isolate a branch and the trail above shows the way out.',
    data: SHARED_DATA,
    options: { minimap: true, nodeSize: { w: 200, h: 72 } },
    content: 'card',
    viewControl: true,
  },
  {
    id: 'selection',
    name: 'Selecting people',
    description:
      'Click a card to select it, hold ⌘/Ctrl to add or remove one, drag with Shift for a box or Alt for a lasso. Esc clears. What you pick is reported back to the page — which is the point: an app does something with a selection.',
    data: SHARED_DATA,
    options: { selection: true, minimap: true, nodeSize: { w: 200, h: 72 } },
    content: 'card',
    selectionControl: true,
  },
  {
    id: 'canvas-only',
    name: 'Canvas only',
    description: 'No cards at all — what the canvas draws by itself. The lightest the chart gets.',
    data: SHARED_DATA,
    options: {},
    content: 'none',
  },
  {
    id: 'flow',
    name: 'Flowing edges',
    description:
      'The dashes travel down the branches that are live. Which ones flow is a predicate you write, not a style you switch on \u2014 and that is deliberate: everything else here draws only when something changes, while a travelling dash has to redraw every frame. Marking one branch is cheap; marking the whole chart is a decision about somebody\u2019s battery. Collapse a live branch and the chart goes quiet again.',
    data: SHARED_DATA,
    options: {
      nodeSize: { w: 200, h: 72 },
      // Two of the eight departments are "live" — enough to see the dashes
      // travel without every line in the chart moving at once.
      edgeFlow: (_parent, child) => {
        const department = departmentOf(String(child.id))
        return department === 'Design' || department === 'Product'
      },
    },
    source: {
      edgeFlow: "(parent, child) => child.department === 'Design' || child.department === 'Product'",
    },
    content: 'status',
  },
  {
    id: 'drag-drop',
    name: 'Drag and drop',
    description:
      'Drag a card onto another to reparent it, or onto the left or right quarter of one to drop it beside that node instead. A drop into the branch you are carrying is refused and shown in red. What actually moves is reported back to the page — an app would send that to a server.',
    data: SHARED_DATA,
    options: { dragAndDrop: true, selection: true, minimap: true, nodeSize: { w: 200, h: 72 } },
    content: 'card',
    dropControl: true,
  },
  {
    id: 'editing',
    name: 'Editing',
    description:
      'Drag somebody onto a manager in the SAME department and it lands. Onto a different one and it goes red under the pointer, before you let go \u2014 that is a rule of your own, not one of the chart\u2019s. No pointer needed either: tab into the chart and use Alt with the arrow keys to move somebody up, down, in or out, or Delete to remove them. Take any of it back with Undo. \u201cSend\u201d shows what an app would post to its server; \u201cNew data from the server\u201d is the other direction, arriving without folding up what you had open.',
    data: SHARED_DATA,
    options: {
      dragAndDrop: true,
      selection: true,
      keyboardEditing: true,
      nodeSize: { w: 210, h: 78 },
      // The rule the example exists to show. Departments are written on the
      // cards, so a refusal is something you can see the reason for rather
      // than a red box you have to take on faith.
      canMove: ({ items, parentId }) => {
        if (parentId === null) return false
        // A reorder is not a reassignment. Everybody's manager is in some
        // OTHER department — that is what a manager is here — so a rule
        // written for "who may you report to" refuses every move within a
        // level as well, and reordering with Alt+Up quietly does nothing.
        // Which it did, until somebody tried it.
        const staying = items.every((item) => {
          const at = EXAMPLE_PARENT.get(String(item.id))
          return at !== undefined && at === parentId
        })
        if (staying) return true
        const into = departmentOf(parentId)
        return into !== null && items.every((item) => departmentOf(String(item.id)) === into)
      },
    },
    content: 'status',
    source: {
      canMove:
        '({ items, parentId }) =>\n    // A reorder keeps the same parent, and is not a reassignment.\n    items.every((item) => item.parentId === parentId) ||\n    items.every((item) => item.department === departmentOf(parentId))',
    },
    editControl: true,
  },
  {
    id: 'filter',
    name: 'Filter and find',
    description:
      'Two answers to \u201cwhere is Rossi\u201d, side by side. FILTER reduces the chart to the matches plus the ancestors that lead to each, so you see where they live \u2014 clear the box and your expand state comes back untouched. FIND changes nothing at all: every node stays where it is and Next walks you to the hits one at a time, opening whatever they were folded behind. Try the same name in both.',
    data: FILTER_DATA,
    options: {
      collapsedByDefault: (_item, at) => at.depth > 1,
      nodeSize: { w: 190, h: 56 },
      minimap: true,
    },
    content: 'card',
    filterControl: true,
  },
  {
    id: 'bounds',
    name: 'Nested set bounds',
    description:
      'Every node carries a pair of numbers that bracket everything below it: `lft` on its left edge, `rgt` on its right. A parent\u2019s pair always encloses its children\u2019s, so the nesting is visible \u2014 and \u201cis this node inside that branch\u201d becomes two comparisons instead of a walk up the tree.',
    data: SHARED_DATA,
    options: {
      collapsedByDefault: (_item, at) => at.depth > 2,
      nodeSize: { w: 210, h: 62 },
    },
    content: 'bounds',
  },
  {
    id: 'wide',
    name: 'Very wide levels',
    description:
      'Four levels of a hundred-odd people, where only a handful per level matter. Every level draws three and rolls the rest into one node \u2014 click it for a searchable list, and tick the people you are working with to pin them onto the chart. The whole level is never shown, because a level of a hundred is the problem this is solving.',
    data: WIDE_DATA,
    options: {
      maxChildren: wideCap,
      pinChildren: (item) => WIDE_WATCHING.has(String(item.id)),
      collapsedByDefault: (item) => String(item.id).split('-').length > 2,
      nodeSize: { w: 190, h: 56 },
    },
    content: 'card',
    gotoControl: true,
  },
  {
    id: 'lazy',
    name: 'Children on demand',
    description:
      'The page has four rows; everything else is fetched when you open a folder. A folder that has not been read yet carries a mark and opens on the first click, then settles rather than jumping. The deepest folders come back empty — `mayHaveChildren` is a guess, and this is what a wrong guess looks like.',
    data: REMOTE_ROOTS,
    options: {
      layout: 'file',
      mayHaveChildren: (item) => item.kind === 'folder',
      loadChildren: (item) => fetchRemoteChildren(item),
      nodeSize: { w: 190, h: 56 },
    },
    // `card`, not `row`, even though this opens as a file list: the `file`
    // preset forces rows anyway, and declaring rows here is what a viewer
    // switching to `tidy` would get instead — file rows, indent lines and all,
    // laid out as a tiered chart. Children on demand is not a file-layout
    // feature and should not look like one the moment you leave it.
    content: 'card',
  },
  {
    id: 'file-tree',
    name: 'File tree',
    description:
      'The file-explorer shape: one indented row per node, folder guide lines down the gutter, and a size on every row. The only layout whose width does not grow as the tree does — a thousand siblings cost a thousand rows, not a thousand columns.',
    data: FILE_DATA,
    options: {
      layout: 'file',
      // Everything else the shape needs comes from LAYOUT_PRESETS. What is
      // left here is the one thing peculiar to THIS example: a source tree
      // opens with its top-level folders showing and the rest closed.
      collapsedByDefault: (item) => String(item.id).split('/').length > 2,
    },
    content: 'row',
  },
  {
    id: 'radial',
    name: 'Radial',
    description:
      'Root at the centre, each generation a ring further out, and every name turned to run along its own spoke — flipped on the left-hand side so nothing reads upside down. For trees that are wide and shallow, where a tiered chart runs off the side of the screen.',
    data: SHARED_DATA,
    options: { layout: 'radial', minimap: true },
    content: 'none',
  },
  {
    id: 'sunburst',
    name: 'Sunburst',
    description:
      'The same file tree as a wheel, each segment sized by what it holds and coloured by which top-level folder it belongs to. Click a segment to drill into it: it widens to the full circle and travels inward while the rest closes at the seam. Click the centre to come back out.',
    data: FILE_DATA,
    options: { layout: 'sunburst' },
    content: 'none',
  },
  {
    id: 'large',
    name: 'Large (20k)',
    description:
      '20,000 nodes. Zoom out and watch the cards give way to labels and then to plain shapes; the minimap in the corner is how you keep your place.',
    // Getter, not a plain property: the 20k-node tree is built on first read
    // of `.data`, i.e. only once this example is actually selected.
    get data() {
      return largeData()
    },
    options: { minimap: true },
    content: 'card',
  },
]
