import { DEFAULT_THEME, type MinimapPosition, type Options, type Theme } from '@klad/core'
import { baseTheme, chartTokens, silhouetteColour, type ThemeMode } from './theme.js'

export type { MinimapPosition } from '@klad/core'

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
  return typeof configured === 'object' && configured.position !== undefined ? configured.position : 'bottom-right'
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
  return typeof configured === 'object'
    ? { ...configured, position, silhouetteColour: silhouette }
    : { position, silhouetteColour: silhouette }
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
 * packages/core/src/render/theme.ts), not a colour at all. The picker
 * control (an `<input type="color">`) can't represent "no colour" itself, so
 * it needs SOME starting hex value ready for the moment a viewer flips the
 * "shape fill" checkbox on; this is that seed, distinct from the mode's own
 * node fill so the two swatches are visually distinguishable at a glance.
 */
export const BLOCK_FILL_SEED = '#e2e8f0'

/**
 * The initial swatch value for the "Ring colour" control — the library's own
 * default (`DEFAULT_THEME.ringStroke` in packages/core/src/render/theme.ts),
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
  edgeCornerRadius: number,
  mode: ThemeMode,
): NonNullable<Options['theme']> {
  return { ...chartTokens(mode), ...example.options.theme, edgeCornerRadius }
}

/**
 * What the chart is ACTUALLY drawing with: the mode's palette, the example's
 * own theme over it, then whatever the sidebar has applied on top. Every
 * appearance control reads its current value out of this rather than
 * remembering one of its own, so a control cannot drift out of step with the
 * chart — switching example, stack or mode re-syncs all of them from one call.
 */
export function effectiveTheme(example: Example, mode: ThemeMode, applied: Partial<Theme>): Theme {
  return { ...baseTheme(mode), ...example.options.theme, ...applied }
}

/**
 * The theme tokens to push into an ALREADY-MOUNTED chart when the viewer flips
 * light/dark — the same layering as `themeFor`, minus the slider's token,
 * which the sidebar owns and must not be reset by a theme flip. Sent through
 * `api.setTheme` (see each demo's `setMode`), so switching mode never touches
 * camera, expand/collapse or highlight state.
 */
export function modeThemeFor(example: Example, mode: ThemeMode): NonNullable<Options['theme']> {
  return { ...chartTokens(mode), ...example.options.theme }
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
export const DEPARTMENTS = ['Engineering', 'Design', 'Product', 'Sales', 'Marketing', 'Finance', 'Support'] as const
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

/** "Person 3" -> "P3", "CEO" -> "CE". No network imagery needed — initials are the avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0)
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
const narrowFanOut: FanOut = (counter, parentId, depth) => (depth < CROWN_DEPTH ? wideFanOut(counter, parentId, depth) : 1)

/** Builds a branching org chart of roughly `target` nodes, using `fanOut` to decide reports-per-manager. */
export function buildOrg(target: number, fanOut: FanOut = wideFanOut): NodeItem[] {
  const data: NodeItem[] = []
  const departmentById = new Map<string, Department>()
  const childCount = new Map<string, number>()

  function push(id: string, parentId: string | undefined, name: string, title: string, department: Department): void {
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
  | 'file'
  | 'card'
  | 'avatar'
  | 'monogram'
  | 'status'
  | 'photo'
  | 'counts'
  | 'dropdown'
  | 'accordion'
  | 'actions'
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
   * Shows the sunburst's breadcrumb bar over the canvas — the trail from the
   * root to whatever is currently at the centre, each step clickable. Same
   * per-example opt-in as the others: it is the point of exactly one example,
   * and on any other layout it would name a "centre" that does not exist.
   */
  centreControl?: boolean
}

// Shared by every example except "Large", which needs its own scale and its
// own lazily-built dataset (see below) so switching to one of the small
// examples never pays the cost of building the 20k-node tree.
// Small enough that the whole chart is comprehensible at 1:1. A few hundred nodes
// is realistic but spreads subtrees thousands of pixels apart, so you only ever see
// a vertical slice of it — which is what the Large example is for.
const SHARED_DATA = buildOrg(28)

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

export const FILE_DATA: NodeItem[] = buildFileTree()

/** Row height for the file-explorer example, and the width every row shares.
 * A file list is a list: uniform rows, one column, the indent doing the work. */
export const FILE_ROW = { w: 300, h: 30 }

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
    id: 'orientations',
    name: 'Orientations',
    description:
      'The same tree growing left to right instead of top to bottom.',
    data: SHARED_DATA,
    options: { orientation: 'lr' },
    content: 'card',
  },
  {
    id: 'rtl',
    name: 'RTL',
    description:
      'Mirrored sibling order, for charts read right to left. The tree still grows downward.',
    data: SHARED_DATA,
    options: { orientation: 'tb', rtl: true },
    content: 'card',
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
    description:
      'The familiar org chart card: initials, a name and a role.',
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
    description:
      'A taller, picture-led card, for charts where the face matters more than the title.',
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
      'A card with its own detail pane, opening independently of the chart\'s own expand and collapse — and the layout sliding out of its way as it grows.',
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
    description:
      'No cards at all — what the canvas draws by itself. The lightest the chart gets.',
    data: SHARED_DATA,
    options: {},
    content: 'none',
  },
  {
    id: 'file-tree',
    name: 'File tree',
    description:
      'The file-explorer shape: one indented row per node, folder guide lines down the gutter, and a size on every row. The only layout whose width does not grow as the tree does — a thousand siblings cost a thousand rows, not a thousand columns.',
    data: FILE_DATA,
    options: {
      layout: 'file',
      nodeSize: FILE_ROW,
      rowGap: 2,
      layoutStep: 18,
      label: () => '',
      // The rows are DOM cards (icon, name, size), so the canvas underneath
      // them draws nothing of its own — no box behind the row, no label to
      // double up with the card's.
      theme: { nodeFill: 'transparent', nodeStroke: 'transparent' },
      toggleOnNodeClick: true,
      collapsedByDefault: (item) => String(item.id).split('/').length > 2,
    },
    content: 'file',
  },
  {
    id: 'radial',
    name: 'Radial',
    description:
      'Root at the centre, each generation a ring further out, and every name turned to run along its own spoke — flipped on the left-hand side so nothing reads upside down. For trees that are wide and shallow, where a tiered chart runs off the side of the screen.',
    data: SHARED_DATA,
    options: {
      layout: 'radial',
      nodeSize: RADIAL_NODE,
      layoutStep: 190,
      // A dot per node, coloured by branch, with the name doing the talking.
      // A full-size card at every ring position is what makes a radial chart
      // look cluttered: the cards collide long before the labels do, and they
      // repeat information the label already carries. Shrinking the node to a
      // marker leaves the ring spacing free to be set by how much room the
      // NAMES need, which is the actual constraint.
      colourBranches: true,
      theme: { cornerRadius: RADIAL_NODE.w / 2, nodeStroke: 'transparent' },
      minimap: true,
    },
    content: 'none',
  },
  {
    id: 'sunburst',
    name: 'Sunburst',
    description:
      'The same file tree as a wheel, each segment sized by what it holds and coloured by which top-level folder it belongs to. Click a segment to drill into it: it widens to the full circle and travels inward while the rest closes at the seam. Click the centre to come back out.',
    data: FILE_DATA,
    options: {
      layout: 'sunburst',
      nodeSize: SUNBURST_NODE,
      layoutStep: 74,
      maxRings: 3,
    },
    content: 'none',
    centreControl: true,
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
