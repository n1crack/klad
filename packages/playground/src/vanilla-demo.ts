import { createOrgChart, type Options, type OrgChartApi } from '@n1crack/orgchart'
import {
  DEPARTMENT_COLOR,
  EDGE_RADIUS_DEFAULT,
  highlightWidthFor,
  initials,
  minimapDefaultOn,
  minimapDefaultPosition,
  minimapOptionFor,
  modeThemeFor,
  themeFor,
  accordionProgress,
  type Department,
  type Example,
  type MinimapPosition,
  type NodeContentKind,
} from './data.js'
import type { ThemeMode } from './theme.js'

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

/**
 * Shows what `NodeContext` now reports about each node's own subtree: direct
 * children, total descendants, and how far the subtree runs below it. These
 * are precomputed once per tree in core (`computeSubtreeStats`), so a card can
 * read them while it is being drawn — counting them here instead would be
 * O(subtree) per node per frame, exactly the work the 50k-node budget forbids.
 *
 * The counts describe the WHOLE tree, not the expanded part: collapse a branch
 * and its node still reports how many people are under it, which is the point.
 */
function renderCounts(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'counts-card'
    card.append(
      document.createElement('strong'),
      document.createElement('small'),
      Object.assign(document.createElement('div'), { className: 'counts-row' }),
    )
    element.append(card)
  }
  const item = context.item
  const department = (item.department as Department | undefined) ?? 'Executive'
  card.style.setProperty('--accent', DEPARTMENT_COLOR[department])
  card.querySelector('strong')!.textContent = String(item.name ?? '')
  card.querySelector('small')!.textContent = String(item.title ?? '')

  const row = card.querySelector<HTMLDivElement>('.counts-row')!
  const cells: [kind: string, value: string, title: string][] = [
    ['direct', String(context.directChildren), 'Direct reports'],
    ['total', String(context.descendants), 'Everyone below, at any depth'],
    ['depth', 'L' + String(context.depth), 'Levels below the root'],
    ['height', '↓' + String(context.height), 'How deep this subtree runs'],
  ]
  // Built once, then only the numbers are rewritten: the overlay pools these
  // elements across frames, so rebuilding the row every frame would be the DOM
  // churn that pooling exists to avoid.
  if (row.childElementCount !== cells.length) {
    row.innerHTML = ''
    for (const cell of cells) {
      const span = document.createElement('span')
      span.className = 'count count-' + cell[0]
      row.append(span)
    }
  }
  cells.forEach((cell, i) => {
    const span = row.children[i] as HTMLSpanElement
    span.textContent = cell[1]
    span.title = cell[2]
  })
  syncToggleButton(card, context)
}

/**
 * A card carrying a real `<select>`. Worth an example of its own because the
 * overlay is a pooled, absolutely-positioned DOM layer over a canvas, and a
 * form control living in it has to keep behaving normally: opening the menu
 * must not pan the chart, and choosing an option must not be swallowed as a
 * node tap. The vanilla layer already treats genuinely interactive elements as
 * theirs rather than the canvas's, so all this needs is `stopPropagation` on
 * the pointer, which keeps the drag-to-pan gesture from starting on it.
 *
 * The chosen value is written back onto the node's own data, so it survives
 * the pooled element being recycled onto another node and back.
 */
const ROLE_OPTIONS = ['Owner', 'Reviewer', 'Observer'] as const

function renderDropdown(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'dropdown-card'
    const text = document.createElement('div')
    text.className = 'dropdown-text'
    text.append(document.createElement('strong'), document.createElement('small'))
    const select = document.createElement('select')
    select.className = 'dropdown-select'
    for (const role of ROLE_OPTIONS) {
      const option = document.createElement('option')
      option.value = role
      option.textContent = role
      select.append(option)
    }
    // Without this, the pointerdown that opens the menu also starts a pan.
    select.addEventListener('pointerdown', (event) => event.stopPropagation())
    card.append(text, select)
    element.append(card)
  }
  const item = context.item
  card.querySelector('strong')!.textContent = String(item.name ?? '')
  card.querySelector('small')!.textContent = String(item.title ?? '')

  const select = card.querySelector<HTMLSelectElement>('.dropdown-select')!
  select.value = String(item.access ?? ROLE_OPTIONS[0])
  // Rebound per node rather than accumulating listeners: assigning `onchange`
  // replaces whatever the previous occupant of this pooled slot left behind.
  select.onchange = () => {
    item.access = select.value
  }
}

/**
 * A card whose detail pane accordions open in place. The interesting part is
 * that this is a SECOND, independent kind of "open" living inside a node — the
 * chart's own expand/collapse is about children, this is about the card's own
 * content — and the two must not be mistaken for each other. So the disclosure
 * state lives on the node's data (`item.detail`), never inferred from
 * `context.open`, and the button keeps its click off the canvas underneath.
 *
 * `nodeSize` is fixed and declared up front (see the README on why layout
 * cannot measure a card), so the pane opens INSIDE the box the layout already
 * reserved rather than resizing the node — which is why this example's node is
 * tall enough to hold the open state.
 */
function renderAccordion(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'accordion-card'
    const head = document.createElement('div')
    head.className = 'accordion-head'
    const text = document.createElement('div')
    text.className = 'accordion-text'
    text.append(document.createElement('strong'), document.createElement('small'))
    const disclosure = document.createElement('button')
    disclosure.type = 'button'
    disclosure.className = 'accordion-btn'
    head.append(text, disclosure)
    const body = document.createElement('div')
    body.className = 'accordion-body'
    card.append(head, body)
    element.append(card)
  }
  const item = context.item
  card.querySelector('strong')!.textContent = String(item.name ?? '')
  card.querySelector('small')!.textContent = String(item.title ?? '')

  const open = item.detail === true
  const progress = accordionProgress(item)
  const body = card.querySelector<HTMLDivElement>('.accordion-body')!
  body.textContent =
    String(item.department ?? '—') +
    ' · ' +
    String(context.directChildren) +
    ' direct · ' +
    String(context.descendants) +
    ' total'
  // Driven by the same eased number the node's height is, so the text fades
  // in as the room for it appears rather than popping at one end. Hidden
  // outright at zero: an empty pane still drawing its own divider reads as a
  // rendering fault rather than a closed pane.
  body.classList.toggle('is-open', progress > 0)
  body.style.opacity = String(progress)

  const disclosure = card.querySelector<HTMLButtonElement>('.accordion-btn')!
  disclosure.textContent = open ? 'Hide details' : 'Details'
  disclosure.setAttribute('aria-expanded', String(open))
  disclosure.onclick = (event) => {
    event.stopPropagation()
    item.detail = !open
    // The node's own SIZE follows the disclosure (see this example's
    // `nodeSize` in data.ts), and sizes are declared rather than measured —
    // layout runs in a worker with no DOM — so the chart has to be told to
    // re-read them. The demo eases `detailT` between 0 and 1 and re-measures
    // on each frame of it, which is what makes the node slide rather than
    // snap.
    element.dispatchEvent(new CustomEvent('playground:slide', { bubbles: true }))
  }
}

/**
 * A custom template that is mostly buttons: the node as a small toolbar. Shows
 * that arbitrary controls can live on a card, each keeping its own click, with
 * the chart's own toggle as merely one of them rather than a fixed affordance
 * the library imposes.
 */
function renderActions(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'actions-card'
    const text = document.createElement('div')
    text.className = 'actions-text'
    text.append(document.createElement('strong'), document.createElement('small'))
    const bar = document.createElement('div')
    bar.className = 'actions-bar'
    card.append(text, bar)
    element.append(card)
  }
  const item = context.item
  card.querySelector('strong')!.textContent = String(item.name ?? '')
  card.querySelector('small')!.textContent = String(item.title ?? '')

  const bar = card.querySelector<HTMLDivElement>('.actions-bar')!
  const buttons: [glyph: string, title: string, onClick: () => void][] = [
    [
      '★',
      item.starred === true ? 'Starred' : 'Star',
      () => {
        item.starred = item.starred !== true
        element.dispatchEvent(new CustomEvent('playground:repaint', { bubbles: true }))
      },
    ],
    [
      '⇢',
      'Go to this node, marking the way',
      () => {
        element.dispatchEvent(
          new CustomEvent('playground:goto', { bubbles: true, detail: { id: context.id } }),
        )
      },
    ],
    [context.open ? '−' : '+', 'Expand or collapse', () => context.toggle()],
  ]
  if (bar.childElementCount !== buttons.length) {
    bar.innerHTML = ''
    for (let i = 0; i < buttons.length; i++) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'action-btn'
      bar.append(button)
    }
  }
  buttons.forEach((spec, i) => {
    const button = bar.children[i] as HTMLButtonElement
    button.textContent = spec[0]
    button.title = spec[1]
    button.classList.toggle('is-on', i === 0 && item.starred === true)
    // The last button is the chart's own toggle, and a leaf has nothing to
    // toggle — hide it rather than offer a control that does nothing.
    button.hidden = i === buttons.length - 1 && !context.hasChildren
    button.onclick = (event) => {
      event.stopPropagation()
      spec[2]()
    }
  })
}

const RENDERERS: Record<NodeContentKind, RenderNode | null> = {
  card: renderCard,
  counts: renderCounts,
  dropdown: renderDropdown,
  accordion: renderAccordion,
  actions: renderActions,
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
  setBlockFill(blockFill: string): void
  setAccent(accent: string): void
  setEdgeWidth(width: number): void
  setRingEnabled(enabled: boolean): void
  setMode(mode: ThemeMode): void
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
  mode: ThemeMode,
  onApiChange: (api: OrgChartApi) => void,
): VanillaDemoHandle {
  const renderNode = RENDERERS[example.content]
  let currentMode = mode
  let minimapOn = minimapDefaultOn(example)
  let minimapPosition = minimapDefaultPosition(example)

  function buildOptions(): Options {
    return {
      data: example.data,
      nodeSize: DEFAULT_NODE_SIZE,
      label: (item) => String(item.name ?? ''),
      ...example.options,
      theme: themeFor(example, EDGE_RADIUS_DEFAULT, currentMode),
      minimap: minimapOptionFor(example, minimapOn, minimapPosition, currentMode),
      ...(renderNode !== null ? { renderNode } : {}),
    }
  }

  const chart = createOrgChart(host, buildOptions())
  onApiChange(chart.api)

  /**
   * A card changed something about ITSELF — a disclosure opened, a star was
   * toggled — so nothing in the chart's own state has moved and it has no
   * reason to draw a frame. The overlay is repainted on every frame the chart
   * draws, so asking for a paint-only theme write (a merge of nothing over the
   * current theme, explicitly documented as never touching tree, layout or
   * camera state) is how a demo card gets itself redrawn without the library
   * needing a "repaint" verb of its own.
   */
  const onRepaint = (): void => {
    chart.api.setTheme({})
  }

  /**
   * A card changed its own SIZE, which the layout has to be told about: sizes
   * are declared through `nodeSize`, never measured off the DOM. `refresh`
   * re-reads them and relayouts while keeping expand/collapse, camera and
   * highlight — unlike `update()`, which replaces the data and resets the
   * tree's open state.
   */
  const onRelayout = (): void => {
    chart.api.refresh()
  }

  /**
   * Eases every accordion card's `detailT` toward its open/closed target and
   * re-measures the chart on each frame, which is what turns a size change
   * into a slide: `nodeSize` is read at layout time, so animating the size
   * means animating the number it returns.
   *
   * One `refresh()` per frame for the ~200ms this runs. That is a full
   * relayout per frame, which is affordable here — this example is 28 nodes —
   * and deliberately not what the library does for its own expand/collapse
   * transition, which interpolates already-computed positions instead
   * precisely so it never relayouts per frame. An app animating node sizes on
   * a large tree should expect the same distinction to matter.
   */
  const SLIDE_MS = 200
  let slideHandle: number | null = null
  const stepSlide = (): void => {
    slideHandle = null
    let moving = false
    for (const item of example.data) {
      const target = item.detail === true ? 1 : 0
      const current = accordionProgress(item)
      if (current === target) continue
      const step = 1000 / 60 / SLIDE_MS
      const next = target > current ? Math.min(target, current + step) : Math.max(target, current - step)
      item.detailT = next
      if (next !== target) moving = true
    }
    chart.api.refresh()
    if (moving) slideHandle = requestAnimationFrame(stepSlide)
  }
  const onSlide = (): void => {
    if (slideHandle === null) slideHandle = requestAnimationFrame(stepSlide)
  }

  /**
   * The go-to-node command in one gesture: mark the way from the root, then
   * fly there and flash the ring on arrival. `pathTo` returns the root-to-node
   * id chain, which is exactly what `highlight` wants, and `focus` opens every
   * collapsed ancestor on the way — so this works from a fully closed chart,
   * not only when the target already happens to be on screen.
   */
  const onGoto = (event: Event): void => {
    const id = (event as CustomEvent<{ id: string }>).detail.id
    chart.api.highlight(chart.api.pathTo(id))
    chart.api.focus(id, { ring: true })
  }

  host.addEventListener('playground:repaint', onRepaint)
  host.addEventListener('playground:relayout', onRelayout)
  host.addEventListener('playground:slide', onSlide)
  host.addEventListener('playground:goto', onGoto)

  return {
    get api() {
      return chart.api
    },
    destroy: () => {
      host.removeEventListener('playground:repaint', onRepaint)
      host.removeEventListener('playground:relayout', onRelayout)
      host.removeEventListener('playground:slide', onSlide)
      if (slideHandle !== null) cancelAnimationFrame(slideHandle)
      host.removeEventListener('playground:goto', onGoto)
      chart.destroy()
    },
    setMinimap(on) {
      minimapOn = on
      // Straight through the API rather than `chart.update()`, so toggling
      // the minimap never resets the tree's expand/collapse state.
      chart.api.setMinimap(minimapOptionFor(example, minimapOn, minimapPosition, currentMode))
    },
    setMinimapPosition(position) {
      minimapPosition = position
      chart.api.setMinimap(minimapOptionFor(example, minimapOn, minimapPosition, currentMode))
    },
    setEdgeRadius(radius) {
      chart.api.setTheme({ edgeCornerRadius: radius })
    },
    setNodeFill(nodeFill) {
      chart.api.setTheme({ nodeFill })
    },
    setBlockFill(blockFill) {
      chart.api.setTheme({ blockFill })
    },
    setAccent(accent) {
      chart.api.setTheme({
        ringStroke: accent,
        edgeHighlightStroke: accent,
        highlightStroke: accent,
      })
    },
    setEdgeWidth(width) {
      chart.api.setTheme({ edgeWidth: width, edgeHighlightWidth: highlightWidthFor(width) })
    },
    setRingEnabled(enabled) {
      chart.api.setRing(enabled)
    },
    /**
     * Light/dark, applied to the chart the same paint-only way every other
     * control here is — the canvas's node fill and stroke have to move with
     * the CSS the cards over them use, or the canvas box shows around each
     * card's edges (see theme.ts). `mode` is also kept for the next
     * `buildOptions()` call, so a later minimap toggle rebuilds the options
     * with the mode the chart is actually in rather than the one it mounted
     * in.
     */
    setMode(next) {
      currentMode = next
      chart.api.setTheme(modeThemeFor(example, next))
      // The minimap's silhouette is the one piece of it the playground's own
      // CSS cannot restyle (see `silhouetteColour` in theme.ts), so it has to
      // be re-applied through the option — but only while the widget is
      // actually showing, since `setMinimap(false)` on an already-hidden
      // minimap would just rebuild nothing.
      if (minimapOn) chart.api.setMinimap(minimapOptionFor(example, true, minimapPosition, next))
    },
  }
}
