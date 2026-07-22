import type { Options } from '@n1crack/orgchart'

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

/** Builds a branching org chart of roughly `target` nodes. */
export function buildOrg(target: number): NodeItem[] {
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
  while (data.length < target) {
    const next: string[] = []
    for (const parentId of frontier) {
      // Fan-out varies per manager. A uniform six-wide tree is pathologically wide —
      // 200 nodes comes out ~30,000px across — and looks nothing like a real chart.
      const reports = 2 + ((counter * 7 + parentId.length) % 3)
      for (let i = 0; i < reports && data.length < target; i++) {
        const id = `n${counter++}`
        const department =
          parentId === 'ceo' ? DEPARTMENTS[counter % DEPARTMENTS.length]! : departmentById.get(parentId)!
        push(id, parentId, `Person ${counter}`, `Role ${i}`, department)
        next.push(id)
      }
    }
    frontier = next
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
export type NodeContentKind = 'card' | 'avatar' | 'monogram' | 'status' | 'photo' | 'none'

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

const SIZE_VARIANTS = [
  { w: 140, h: 56 },
  { w: 200, h: 72 },
  { w: 170, h: 96 },
]

let largeDataCache: NodeItem[] | null = null
function largeData(): NodeItem[] {
  largeDataCache ??= buildOrg(20_000)
  return largeDataCache
}

export const EXAMPLES: Example[] = [
  {
    id: 'basic',
    name: 'Basic',
    description:
      "28 nodes, every option left at its default (plus minimap: true) — the reference example. At this scale the minimap's silhouette actually reads as a tree, and the viewport rectangle covers a real fraction of it — contrast that with Large, below, where the tree is 700x wider than it is tall.",
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
      'A round initials monogram with a department-coloured ring, name below rather than beside it — taller than it is wide (nodeSize: 96×104), with no room for its own toggle button. toggleOnNodeClick: true instead: tap a node with reports to expand or collapse it (cursor: pointer signals that).',
    data: SHARED_DATA,
    options: { nodeSize: { w: 96, h: 104 }, toggleOnNodeClick: true },
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
      '20,000 nodes with the minimap on. Zoom in and out to watch the LOD tiers switch (thresholds at k = 0.25 and k = 0.6), and use the silhouette in the corner to see where you are in the whole tree.',
    // Getter, not a plain property: the 20k-node tree is built on first read
    // of `.data`, i.e. only once this example is actually selected.
    get data() {
      return largeData()
    },
    options: { minimap: true },
    content: 'card',
  },
]
