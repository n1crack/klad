import type { MinimapPosition, Options } from '@n1crack/orgchart'

export type { MinimapPosition } from '@n1crack/orgchart'

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
 * The effective `minimap` option for `on`/`off` and the chosen corner, given
 * `example`'s own config. `position` always wins over whatever the example
 * itself declared — it is the playground's own dropdown control, and the
 * point of the control is that the viewer can move the widget regardless of
 * what an individual example happened to configure.
 */
export function minimapOptionFor(
  example: Example,
  on: boolean,
  position: MinimapPosition,
): NonNullable<Options['minimap']> {
  if (!on) return false
  const configured = minimapOnConfig(example)
  return typeof configured === 'object' ? { ...configured, position } : { position }
}

/** Slider bounds and default for the "Edge radius" control — see `themeFor`. */
export const EDGE_RADIUS_MIN = 0
export const EDGE_RADIUS_MAX = 24
export const EDGE_RADIUS_DEFAULT = 0

/**
 * The initial swatch value for the "Node fill" control — the library's own
 * default (`DEFAULT_THEME.nodeFill` in packages/core/src/render/theme.ts),
 * not each example's own effective value. Unlike `EDGE_RADIUS_DEFAULT`, this
 * is NEVER baked into `themeFor`/construction-time options: an example that
 * declares its own `nodeFill` for a reason (Avatar/Monogram's transparent
 * node box, so only the circle+name paint) must keep it on first mount,
 * untouched, until a viewer actually drags this control — see
 * `setNodeFill` in vanilla-demo.ts/VueDemo.vue/ReactDemo.tsx, which goes
 * straight through `api.setTheme({ nodeFill })`, never through
 * `buildOptions`/`themeFor`.
 */
export const NODE_FILL_DEFAULT = '#ffffff'

/**
 * The swatch value the "Shape fill" colour picker SEEDS with once a viewer
 * turns it on — not the library's own `block`-tier default, which is
 * `'transparent'` (`DEFAULT_THEME.blockFill` in
 * packages/core/src/render/theme.ts), not a colour at all. The picker
 * control (an `<input type="color">`) can't represent "no colour" itself, so
 * it needs SOME starting hex value ready for the moment a viewer flips the
 * "shape fill" checkbox on; this is that seed, distinct from `NODE_FILL_DEFAULT`
 * so the two swatches are visually distinguishable at a glance.
 */
export const BLOCK_FILL_SEED = '#e2e8f0'

/**
 * The initial swatch value for the "Ring colour" control — the library's own
 * default (`DEFAULT_THEME.ringStroke` in packages/core/src/render/theme.ts),
 * same convention as `NODE_FILL_DEFAULT` above.
 */
export const RING_STROKE_DEFAULT = '#f59e0b'

/**
 * The effective `theme` for `example`, with `edgeCornerRadius` set from the
 * playground's own slider. Merged over the example's own declared theme
 * (rather than replacing it) so examples that already set theme tokens for
 * their own reasons — Avatar circle's transparent node box, for instance —
 * keep them; the slider only ever adds or overrides the one token it owns.
 *
 * `nodeFill`/`blockFill`/`ringStroke` deliberately have NO equivalent
 * parameter here — see `NODE_FILL_DEFAULT`'s docblock for why those controls
 * never touch construction-time options at all, live-only via `api.setTheme`.
 */
export function themeFor(example: Example, edgeCornerRadius: number): NonNullable<Options['theme']> {
  return { ...example.options.theme, edgeCornerRadius }
}

/** Options for the minimap-corner `<select>`, in on-screen order. */
export const MINIMAP_POSITIONS: { value: MinimapPosition; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

/**
 * `NodeData` itself is not re-exported from `@n1crack/orgchart`'s public
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

export const EXAMPLES: Example[] = [
  {
    id: 'basic',
    name: 'Basic',
    description:
      "28 nodes, every option left at its default (plus minimap: true) — the reference example. At this scale the minimap's silhouette actually reads as a tree, and the viewport rectangle covers a real fraction of it — contrast that with Large, below, which is deep and narrow rather than wide.",
    data: SHARED_DATA,
    options: { minimap: true },
    content: 'card',
  },
  {
    id: 'orientations',
    name: 'Orientations',
    description:
      "Same data as Basic, laid out with orientation: 'lr'. Connector elbows split on the x axis instead of the y axis.",
    data: SHARED_DATA,
    options: { orientation: 'lr' },
    content: 'card',
  },
  {
    id: 'rtl',
    name: 'RTL',
    description:
      "Same data, rtl: true on a top-to-bottom chart — sibling order mirrors, the growth direction does not.",
    data: SHARED_DATA,
    options: { orientation: 'tb', rtl: true },
    content: 'card',
  },
  {
    id: 'variable-sizes',
    name: 'Variable node sizes',
    description:
      'nodeSize is a function returning one of three sizes per node, so the layout has to handle mismatched node dimensions.',
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
    description: 'collapsedByDefault: true — every node starts closed; expand from a cold start.',
    data: SHARED_DATA,
    options: { collapsedByDefault: true },
    content: 'card',
  },
  {
    id: 'avatar-card',
    name: 'Avatar card',
    description:
      'Circular initials monogram plus name and role — the most common org chart look. nodeSize: 224×96, declared to fit exactly. minimap: true — a wider node size shifts the silhouette proportions versus Basic.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 224, h: 96 }, minimap: true },
    content: 'avatar',
  },
  {
    id: 'avatar-circle',
    name: 'Avatar circle',
    description:
      'Just a floating circle and a name — no card box. The connector meets the node at the bottom, under the name, where a +/- toggle sits tight against that junction (shown only on nodes with reports; a leaf shows none). nodeSize: 96×108, snug around the circle, name and toggle with almost no slack. toggleOnNodeClick: true still works too: tap the circle itself to expand or collapse. The canvas\'s own node box is made transparent via theme.nodeFill/nodeStroke so nothing but the circle, name and toggle ever paints, and label is suppressed so the canvas does not also draw the name as plain text underneath.',
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
      'Department-coloured accent plus a headcount badge — a second dimension of meaning riding along with the hierarchy. No room left for a toggle button at this density, so toggleOnNodeClick: true is on instead: tap the card to expand or collapse it. nodeSize: 208×88. minimap: true, top-left this time — position is per-instance.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 208, h: 88 }, toggleOnNodeClick: true, minimap: { position: 'top-left' } },
    content: 'status',
  },
  {
    id: 'photo-tile',
    name: 'Photo tile',
    description:
      'A squarer, image-dominant card (CSS-gradient placeholder photo, no network) — a very different aspect ratio from the wide default card. nodeSize: 132×156.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 132, h: 156 } },
    content: 'photo',
  },
  {
    id: 'counts',
    name: 'Subtree counts',
    description:
      'Every card reports its own subtree: direct reports, everyone below at any depth, its level from the root, and how deep its own subtree runs. All four come from the node context and are precomputed once per tree, so a card reads them as array lookups rather than counting a subtree while it is being drawn. Collapse a branch and the numbers do not change — they describe the whole tree, not the part currently expanded. nodeSize: 216×96.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 216, h: 96 } },
    content: 'counts',
  },
  {
    id: 'dropdown',
    name: 'Card with a dropdown',
    description:
      'A real <select> living on a pooled overlay card above the canvas. Opening the menu must not pan the chart and choosing an option must not read as a node tap; the chosen value is written back to the node data so it survives the element being recycled onto another node. nodeSize: 208×92.',
    data: SHARED_DATA,
    options: { nodeSize: { w: 208, h: 92 } },
    content: 'dropdown',
  },
  {
    id: 'accordion',
    name: 'Accordion detail',
    description:
      "A second, independent kind of open: the card's own detail pane, which has nothing to do with the chart's expand/collapse of children. The disclosure state lives on the node data, and the node GROWS with it — nodeSize is a function of that state, so opening a card makes it taller and the whole layout reflows around it. It slides rather than snapping: sizes are declared, never measured off the DOM (layout runs in a worker), so the demo eases the number nodeSize returns from 72 to 132 over 200ms and calls api.refresh() on each frame — which re-reads every node's size while keeping expand/collapse, camera and highlight exactly where they were. Note that this is a full relayout per frame, affordable at 28 nodes and deliberately not how the library's own expand/collapse transition works.",
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
      "The node as a small toolbar: star it, jump to it, expand it. Arbitrary controls can live on a card and each keeps its own click — the chart's own toggle is just one button among them rather than an affordance the library imposes. The ⇢ button marks the path from the root and flies there with a confirmation ring, which is the go-to-node command in one gesture. nodeSize: 212×96.",
    data: SHARED_DATA,
    options: { nodeSize: { w: 212, h: 96 } },
    content: 'actions',
  },
  {
    id: 'canvas-only',
    name: 'Canvas only',
    description:
      'No renderNode at all — the chart is pure canvas. A frameworkless user pays nothing for DOM; this is what the canvas tier draws on its own.',
    data: SHARED_DATA,
    options: {},
    content: 'none',
  },
  {
    id: 'large',
    name: 'Large (20k)',
    description:
      "20,000 nodes with the minimap on: a normal-looking crown for the first few levels, then long single-file reporting chains, so the tree reads as tall and narrow (~127 levels deep) rather than the near-flat band a uniformly branching tree of this size would be. Zoom in and out to watch the LOD tiers switch (thresholds at k = 0.25 and k = 0.6), and use the silhouette in the corner to see where you are in the whole tree.",
    // Getter, not a plain property: the 20k-node tree is built on first read
    // of `.data`, i.e. only once this example is actually selected.
    get data() {
      return largeData()
    },
    options: { minimap: true },
    content: 'card',
  },
]
