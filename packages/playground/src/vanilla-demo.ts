import { createOrgChart, type Options, type OrgChartApi } from '@n1crack/orgchart'
import {
  DEPARTMENT_COLOR,
  EDGE_RADIUS_DEFAULT,
  initials,
  minimapDefaultOn,
  minimapDefaultPosition,
  minimapOptionFor,
  themeFor,
  type Department,
  type Example,
  type MinimapPosition,
  type NodeContentKind,
} from './data.js'

const DEFAULT_NODE_SIZE = { w: 180, h: 64 }

type RenderNode = NonNullable<Options['renderNode']>
type NodeContext = Parameters<RenderNode>[1]

/** Attaches (or updates) the +/− toggle button shared by every card that has room for one. */
function syncToggleButton(container: HTMLElement, context: NodeContext): void {
  let toggleBtn = container.querySelector<HTMLButtonElement>('.toggle-btn')
  if (context.hasChildren) {
    if (toggleBtn === null) {
      toggleBtn = document.createElement('button')
      toggleBtn.type = 'button'
      toggleBtn.className = 'toggle-btn'
      container.append(toggleBtn)
    }
    toggleBtn.textContent = context.open ? '−' : '+'
    toggleBtn.onclick = (event) => {
      event.stopPropagation()
      context.toggle()
    }
  } else if (toggleBtn !== null) {
    toggleBtn.remove()
  }
}

/**
 * Renders the `<strong>name</strong><small>title</small>` card — the default
 * look used by every example that doesn't ask for something else. The pooled
 * overlay element is reused across frames (see packages/vanilla/src/overlay.ts),
 * so this only builds the inner nodes once per slot and just updates their
 * text on later frames — rebuilding the subtree every frame would add exactly
 * the DOM churn the pooling exists to avoid.
 */
function renderCard(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'card'
    card.append(document.createElement('strong'), document.createElement('small'))
    element.append(card)
  }
  const item = context.item
  card.querySelector('strong')!.textContent = String(item.name ?? '')
  card.querySelector('small')!.textContent = String(item.title ?? '')
  syncToggleButton(card, context)
}

/** Circular initials monogram + name + role. */
function renderAvatar(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'avatar-card'
    const avatar = document.createElement('div')
    avatar.className = 'avatar-circle'
    const text = document.createElement('div')
    text.className = 'avatar-text'
    text.append(document.createElement('strong'), document.createElement('small'))
    card.append(avatar, text)
    element.append(card)
  }
  const item = context.item
  const department = (item.department as Department | undefined) ?? 'Executive'
  const avatarEl = card.querySelector<HTMLDivElement>('.avatar-circle')!
  avatarEl.textContent = initials(String(item.name ?? ''))
  avatarEl.style.background = DEPARTMENT_COLOR[department]
  card.querySelector('strong')!.textContent = String(item.name ?? '')
  card.querySelector('small')!.textContent = String(item.title ?? '')
  syncToggleButton(card, context)
}

/**
 * Round initials monogram with a department-coloured ring and the name below
 * it — no card box at all, just the circle and the name floating directly on
 * the canvas (the canvas's own node box is made transparent for this example
 * via `theme.nodeFill`/`nodeStroke`, see data.ts). `cursor: pointer` because
 * the whole node is also a toggle (toggleOnNodeClick: true).
 *
 * The +/- toggle sits below the name, in normal flex flow rather than
 * absolutely tucked into a corner: that is where this node's OUTGOING
 * connector to its own children attaches (bottom-centre of the node box, see
 * canvas2d.ts), so the button visually sits right at the junction the line
 * arrives at. Reuses `syncToggleButton`, so it only appears for nodes that
 * actually have children — its presence alone is what tells a viewer "there
 * is more below" without them having to click to find out; a leaf renders no
 * toggle at all.
 */
function renderMonogram(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'monogram-card'
    const circle = document.createElement('div')
    circle.className = 'monogram-circle'
    const label = document.createElement('span')
    label.className = 'monogram-name'
    card.append(circle, label)
    element.append(card)
  }
  const item = context.item
  const department = (item.department as Department | undefined) ?? 'Executive'
  card.style.setProperty('--accent', DEPARTMENT_COLOR[department])
  card.querySelector<HTMLDivElement>('.monogram-circle')!.textContent = initials(String(item.name ?? ''))
  card.querySelector('.monogram-name')!.textContent = String(item.name ?? '')
  syncToggleButton(card, context)
}

/** Department-coloured accent + department and headcount badges. */
function renderStatus(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'status-card'
    card.append(
      document.createElement('strong'),
      document.createElement('small'),
      Object.assign(document.createElement('div'), { className: 'status-badges' }),
    )
    element.append(card)
  }
  const item = context.item
  const department = (item.department as Department | undefined) ?? 'Executive'
  const headcount = Number(item.headcount ?? 0)
  card.style.setProperty('--accent', DEPARTMENT_COLOR[department])
  card.querySelector('strong')!.textContent = String(item.name ?? '')
  card.querySelector('small')!.textContent = String(item.title ?? '')

  const badges = card.querySelector<HTMLDivElement>('.status-badges')!
  badges.innerHTML = ''
  const deptBadge = document.createElement('span')
  deptBadge.className = 'badge badge-dept'
  deptBadge.textContent = department
  badges.append(deptBadge)
  if (headcount > 0) {
    const countBadge = document.createElement('span')
    countBadge.className = 'badge badge-count'
    countBadge.textContent = `${headcount} report${headcount === 1 ? '' : 's'}`
    badges.append(countBadge)
  }
  // No toggle button here: at this card's information density (name, title,
  // two badges) there's no clearance left for one without overlapping the
  // badge row. The sidebar's Expand All / Collapse All still work.
}

/** Squarer, image-dominant tile: a CSS-gradient "photo" (initials) over a name/title band. */
function renderPhoto(element: HTMLElement, context: NodeContext): void {
  let tile = element.firstElementChild as HTMLDivElement | null
  if (tile === null) {
    tile = document.createElement('div')
    tile.className = 'photo-tile'
    const photo = document.createElement('div')
    photo.className = 'photo-image'
    photo.append(document.createElement('span'))
    const caption = document.createElement('div')
    caption.className = 'photo-caption'
    caption.append(document.createElement('strong'), document.createElement('small'))
    tile.append(photo, caption)
    element.append(tile)
  }
  const item = context.item
  const department = (item.department as Department | undefined) ?? 'Executive'
  const colour = DEPARTMENT_COLOR[department]
  const photoEl = tile.querySelector<HTMLDivElement>('.photo-image')!
  photoEl.style.background = `linear-gradient(155deg, ${colour}, color-mix(in srgb, ${colour} 55%, black))`
  photoEl.querySelector('span')!.textContent = initials(String(item.name ?? ''))
  tile.querySelector('strong')!.textContent = String(item.name ?? '')
  tile.querySelector('small')!.textContent = String(item.title ?? '')
  syncToggleButton(tile, context)
}

const RENDERERS: Record<NodeContentKind, RenderNode | null> = {
  card: renderCard,
  avatar: renderAvatar,
  monogram: renderMonogram,
  status: renderStatus,
  photo: renderPhoto,
  none: null,
}

/** Imperative handle main.ts uses to drive the mounted vanilla chart's live controls. */
export interface VanillaDemoHandle {
  readonly api: OrgChartApi
  destroy(): void
  setMinimap(on: boolean): void
  setMinimapPosition(position: MinimapPosition): void
  setEdgeRadius(radius: number): void
  setNodeFill(nodeFill: string): void
}

/**
 * The vanilla stack's playground demo. Unlike VueDemo.vue/ReactDemo.tsx —
 * which get `chart.update()` for free from a reactive `options` object their
 * framework already watches — this stack has no such mechanism of its own,
 * so `buildOptions` is called by hand every time the minimap on/off or
 * minimap corner control changes, closing over whichever of those two
 * values is current.
 *
 * `setEdgeRadius`/`setNodeFill` go straight through `chart.api.setTheme`
 * instead — `OrgChartApi.setTheme` (packages/vanilla/src/index.ts) merges a
 * partial theme over whatever the chart is already showing, re-resolves it,
 * and repaints, all without touching tree/layout state. Before that method
 * existed, the only way to change a theme token post-construction was to
 * tear the chart down and build a new one (see this file's git history) —
 * which also reset camera position and expand/collapse state on every drag
 * tick, unlike `setMinimap`. `setTheme` fixes both problems at once.
 */
export function mountVanilla(
  host: HTMLElement,
  example: Example,
  onApiChange: (api: OrgChartApi) => void,
): VanillaDemoHandle {
  const renderNode = RENDERERS[example.content]
  let minimapOn = minimapDefaultOn(example)
  let minimapPosition = minimapDefaultPosition(example)

  function buildOptions(): Options {
    return {
      data: example.data,
      nodeSize: DEFAULT_NODE_SIZE,
      label: (item) => String(item.name ?? ''),
      ...example.options,
      theme: themeFor(example, EDGE_RADIUS_DEFAULT),
      minimap: minimapOptionFor(example, minimapOn, minimapPosition),
      ...(renderNode !== null ? { renderNode } : {}),
    }
  }

  const chart = createOrgChart(host, buildOptions())
  onApiChange(chart.api)

  return {
    get api() {
      return chart.api
    },
    destroy: () => chart.destroy(),
    setMinimap(on) {
      minimapOn = on
      // Straight through the API rather than `chart.update()`, so toggling
      // the minimap never resets the tree's expand/collapse state.
      chart.api.setMinimap(minimapOptionFor(example, minimapOn, minimapPosition))
    },
    setMinimapPosition(position) {
      minimapPosition = position
      chart.api.setMinimap(minimapOptionFor(example, minimapOn, minimapPosition))
    },
    setEdgeRadius(radius) {
      chart.api.setTheme({ edgeCornerRadius: radius })
    },
    setNodeFill(nodeFill) {
      chart.api.setTheme({ nodeFill })
    },
  }
}
