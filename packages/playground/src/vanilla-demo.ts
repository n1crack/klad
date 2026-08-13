import { createKlad, type KladApi, type LayoutSettings, type Options, type Theme } from '@klad/core'
import { openPickerFor, overflowLabel } from './overflow-card.js'
import {
  DEPARTMENT_COLOR,
  SHARED_DATA,
  slotBranchColour,
  EDGE_RADIUS_DEFAULT,
  initials,
  minimapDefaultOn,
  minimapDefaultPosition,
  minimapOptionFor,
  modeThemeFor,
  dropDetail,
  rowFields,
  isBranchRow,
  optionsForLayout,
  rememberParent,
  contentForLayout,
  themeFor,
  accordionProgress,
  type Department,
  type Example,
  type LayoutName,
  type MinimapPosition,
  type NodeContentKind,
} from './data.js'
import { createAccordionSlide, createDrill, createHoverTrail, goTo } from './demo-behaviour.js'
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
 * overlay element is reused across frames (see packages/core/src/overlay.ts),
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
  // The node a capped level rolled its remainder into. It is the chart's own
  // invention, so it has no `name` to show — what it has is a count and the
  // nodes it stands for, and a click that opens a list you can pick from.
  const over = context.overflow
  card.classList.toggle('is-overflow', over !== null)
  card.querySelector('strong')!.textContent = over === null ? String(item.name ?? '') : overflowLabel(over)
  card.querySelector('small')!.textContent =
    over === null ? String(item.title ?? '') : 'Click to search and pick'
  card.onclick = over === null ? null : () => openPickerFor(card, over, context.id)
  // Waiting on `loadChildren`. The file row shows this on its chevron; a card
  // has no chevron to show it on, so it says so itself — otherwise the only
  // feedback for a click that starts a network request is nothing at all.
  card.classList.toggle('is-loading', context.loading)
  syncToggleButton(card, context)
}

/**
 * One indented row: a disclosure chevron, an icon, the name, and one number or
 * phrase on the right.
 *
 * Everything about the row is DOM — the `file` layout worked out where it goes
 * and how far in it is indented, and drew nothing. The canvas underneath is
 * left transparent (see `LAYOUT_PRESETS`) so there is no box behind the row
 * and no second copy of the name; what the canvas DOES still draw is the
 * folder guide lines, which is the part a DOM row cannot do without an element
 * per line.
 *
 * The FIELDS come from `rowFields`, which reads whichever dataset it is given
 * — a directory tree or an org chart. The layout picker can put any example
 * into this shape, and a row that only knew about files would render half of
 * them blank.
 */
function renderRow(element: HTMLElement, context: NodeContext): void {
  let row = element.firstElementChild as HTMLDivElement | null
  if (row === null) {
    row = document.createElement('div')
    row.className = 'file-row'
    const chevron = document.createElement('button')
    chevron.type = 'button'
    chevron.className = 'file-chevron'
    const icon = document.createElement('span')
    icon.className = 'file-icon'
    const name = document.createElement('span')
    name.className = 'file-name'
    const meta = document.createElement('span')
    meta.className = 'file-size'
    row.append(chevron, icon, name, meta)
    element.append(row)
  }
  const fields = rowFields(context.item, context.open)
  const chevron = row.querySelector<HTMLButtonElement>('.file-chevron')!
  // A leaf keeps the chevron's WIDTH but not its glyph, so every name in a run
  // of siblings starts at the same x — a list where leaves and branches begin
  // at different offsets reads as broken indentation.
  // While a fetch is in flight the chevron says so, in the one place the eye
  // is already on: the thing that was just clicked. It also stops rotating —
  // a chevron that pointed down at a row with nothing under it would be
  // claiming the branch is open when it is still on its way.
  chevron.textContent = context.loading ? '⋯' : context.hasChildren ? '▸' : ''
  chevron.classList.toggle('is-open', context.open && !context.loading)
  chevron.classList.toggle('is-loading', context.loading)
  chevron.disabled = !context.hasChildren
  chevron.setAttribute('aria-hidden', context.hasChildren ? 'false' : 'true')
  chevron.onclick = (event) => {
    event.stopPropagation()
    context.toggle()
  }
  const icon = row.querySelector<HTMLSpanElement>('.file-icon')!
  icon.textContent = fields.icon
  icon.classList.toggle('is-chip', fields.iconColour !== '')
  icon.style.background = fields.iconColour
  row.querySelector<HTMLSpanElement>('.file-name')!.textContent = fields.primary
  row.querySelector<HTMLSpanElement>('.file-size')!.textContent = fields.secondary
  row.classList.toggle('is-folder', isBranchRow(context.item, context.hasChildren))
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

/**
 * The showcase card: a stadium — a slot, in the sense a technical drawing
 * means it — with the branch's own colour running down its leading edge and a
 * dot to pick it up again at the end.
 *
 * The accent comes from the same palette the chart paints connectors with (see
 * `SLOT_PALETTE`), so a card and the line arriving at it are the same colour by
 * construction rather than by two lists that have to be kept in step. The
 * hover state is CSS on the element itself: the canvas underneath lights the
 * ROUTE (see the `nodeHover` wiring), and the card lifts to meet it.
 */
function renderSlot(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'slot-card'
    card.append(
      Object.assign(document.createElement('span'), { className: 'slot-dot' }),
      Object.assign(document.createElement('div'), { className: 'slot-text' }),
    )
    card
      .querySelector('.slot-text')!
      .append(document.createElement('strong'), document.createElement('small'))
    element.append(card)
  }
  const item = context.item
  const accent = slotBranchColour(SHARED_DATA, String(item.id))
  card.style.setProperty('--accent', accent ?? 'var(--slot-hub)')
  card.classList.toggle('is-hub', accent === null)
  card.classList.toggle('is-open', context.open)
  card.classList.toggle('has-children', context.hasChildren)
  card.querySelector('strong')!.textContent = String(item.name ?? '')
  card.querySelector('small')!.textContent = String(item.title ?? '')
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
/**
 * A card with its nested-set bounds on the edges they describe: `lft` against
 * the left border, `rgt` against the right.
 *
 * The placement IS the explanation. A parent's pair encloses every pair below
 * it, so reading down a branch the numbers step inward on the left and outward
 * on the right — which is what makes "inside" a comparison rather than a walk.
 */
function renderBounds(element: HTMLElement, context: NodeContext): void {
  let card = element.firstElementChild as HTMLDivElement | null
  if (card === null) {
    card = document.createElement('div')
    card.className = 'bounds-card'
    card.append(
      Object.assign(document.createElement('span'), { className: 'bounds-lft' }),
      Object.assign(document.createElement('div'), { className: 'bounds-body' }),
      Object.assign(document.createElement('span'), { className: 'bounds-rgt' }),
    )
    card
      .querySelector('.bounds-body')!
      .append(document.createElement('strong'), document.createElement('small'))
    element.append(card)
  }
  const item = context.item
  card.querySelector('.bounds-lft')!.textContent = String(context.lft)
  card.querySelector('.bounds-rgt')!.textContent = String(context.rgt)
  card.querySelector('strong')!.textContent = String(item.name ?? '')
  // `rgt - lft` is `2 * descendants + 1`, so the pair carries the subtree size
  // as well as the position. Worth saying on the card, since it is the part
  // people do not expect.
  card.querySelector('small')!.textContent =
    context.descendants === 0 ? 'leaf' : `${context.descendants} below`
  syncToggleButton(card, context)
}

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
  row: renderRow,
  card: renderCard,
  counts: renderCounts,
  bounds: renderBounds,
  dropdown: renderDropdown,
  accordion: renderAccordion,
  actions: renderActions,
  avatar: renderAvatar,
  monogram: renderMonogram,
  status: renderStatus,
  slot: renderSlot,
  photo: renderPhoto,
  none: null,
}

/** Imperative handle main.ts uses to drive the mounted vanilla chart's live controls. */
export interface VanillaDemoHandle {
  readonly api: KladApi
  destroy(): void
  setMinimap(on: boolean): void
  setMinimapPosition(position: MinimapPosition): void
  setMinimapSilhouette(colour: string): void
  /**
   * One door for every theme token the sidebar owns, rather than a method per
   * control. `api.setTheme` already merges a partial over the live theme, so
   * the demo has nothing to add on top of it — and a sidebar that grew a
   * handful of new tokens (label colour, node stroke, ring width) would
   * otherwise have grown the same handful of one-line methods in three files.
   */
  setTheme(partial: Partial<Theme>): void
  setRingEnabled(enabled: boolean): void
  /** Live layout tuning — see `KladApi.setLayoutOptions`. Never a remount, so
   * the tree's open state and the camera survive a slider drag. */
  setLayoutOptions(settings: LayoutSettings, fit: boolean): void
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
 * instead — `KladApi.setTheme` (packages/core/src/index.ts) merges a
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
  layout: LayoutName,
  mode: ThemeMode,
  onApiChange: (api: KladApi) => void,
  onDrop?: (detail: { ids: string[]; parentId: string | null; mode: string }) => void,
  onCentreChange?: (id: string | null) => void,
  onEdit?: () => void,
): VanillaDemoHandle {
  // The content treatment follows the LAYOUT, not the example — see
  // `LAYOUT_PRESETS` in data.ts. A wheel draws its own text on the canvas and
  // wants no overlay at all; a file list wants rows whatever the example's own
  // card would have been.
  const renderNode = RENDERERS[contentForLayout(example, layout)]
  let currentMode = mode
  let minimapOn = minimapDefaultOn(example)
  let minimapPosition = minimapDefaultPosition(example)
  /**
   * The viewer's own silhouette colour, or `null` while they have not picked
   * one — in which case the mode's default applies and keeps applying, so
   * flipping light/dark still recolours it. See `minimapOptionFor`.
   */
  let minimapSilhouette: string | null = null

  function minimapOption(): NonNullable<Options['minimap']> {
    const base = minimapOptionFor(example, minimapOn, minimapPosition, currentMode)
    // `typeof base !== 'object'` rather than `=== false`: the option's type
    // allows a bare `true`, which has nowhere to carry a colour.
    if (typeof base !== 'object' || minimapSilhouette === null) return base
    return { ...base, silhouetteColour: minimapSilhouette }
  }

  function buildOptions(): Options {
    return {
      data: example.data,
      nodeSize: DEFAULT_NODE_SIZE,
      label: (item) => String(item.name ?? ''),
      ...optionsForLayout(example, layout),
      theme: themeFor(example, layout, EDGE_RADIUS_DEFAULT, currentMode),
      minimap: minimapOption(),
      ...(renderNode !== null ? { renderNode } : {}),
    }
  }

  const chart = createKlad(host, buildOptions())
  onApiChange(chart.api)

  /**
   * On a phone, open on the whole tree.
   *
   * A chart opens centred on its root at 1:1, which is the right default —
   * zooming out on somebody's behalf hides the thing they came to read. On a
   * 360px column it means landing on an arbitrary slice: the root at the top,
   * a gap, and two nodes four levels down with everything between them off to
   * the sides. Fitting is the only view that says anything there.
   *
   * Two attempts before this one, both wrong for the same reason in different
   * ways. A fixed pair of animation frames fitted against empty bounds — the
   * tree is laid out in a worker, so they arrive when they arrive. Fitting on
   * the first frame that HAS bounds got the bounds right and the box wrong:
   * the mobile layout is still settling at that point, the sidebar collapsing
   * into a drawer, and a fit measured against a box that is about to change
   * is stale a moment later.
   *
   * And what it does is put the root near the top, not fit the tree. Fitting was the
   * obvious answer and the wrong one: twenty-eight nodes across 414 pixels is
   * everything visible and nothing readable — a wireframe, not a chart. The
   * root at a legible size, with its children under it and the rest a swipe
   * away, is what a phone can actually show. Whether that is right for a given example is a judgement,
   * and this is the one place it is made.
   *
   * It re-centres whenever the box changes, until the viewer touches the
   * chart. After that the camera is theirs and nothing here moves it.
   */
  let ownsCamera = true
  const releaseCamera = (): void => {
    ownsCamera = false
  }
  if (window.innerWidth < 640) {
    for (const type of ['pointerdown', 'wheel', 'keydown'] as const) {
      host.addEventListener(type, releaseCamera, { once: true, passive: true })
    }
    const fitIfUntouched = (): void => {
      if (!ownsCamera) return
      const box = host.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) return
      const state = chart.api.getState()
      if (state.bounds.maxX <= state.bounds.minX) return
      // Where the root goes depends on which way the tree GROWS. Centring it
      // spends half a screen on the empty side; putting it a fifth of the way
      // in from the edge it grows away from leaves that space for the tree.
      //
      // A left-to-right chart caught this: the rule started as "near the top",
      // which on `lr` put the root in the middle of the width with the entire
      // tree off the right-hand edge — one card and a blank screen.
      const mounted = optionsForLayout(example, layout)
      const polar = layout === 'radial' || layout === 'sunburst'
      const orientation = layout === 'tidy' ? (mounted.orientation ?? 'tb') : 'tb'
      // A file list is read from its first row down, so it starts at the top
      // edge — a fifth of the way in wasted a hundred pixels of a phone on
      // nothing. Every other shape wants room on the side it grows away from.
      const near = layout === 'file' ? 0.04 : 0.2
      const far = 1 - near
      const at = polar
        ? { x: 0.5, y: 0.5 }
        : orientation === 'lr'
          ? { x: near, y: 0.5 }
          : orientation === 'rl'
            ? { x: far, y: 0.5 }
            : orientation === 'bt'
              ? { x: 0.5, y: far }
              : { x: 0.5, y: near }
      const view = chart.api.getView()
      chart.api.setView({
        ...view,
        camera: {
          ...view.camera,
          x: view.camera.x + (box.width * at.x - state.rootScreenCentre.x),
          y: view.camera.y + (box.height * at.y - state.rootScreenCentre.y),
        },
      })
    }
    const stopFit = chart.subscribe((state) => {
      if (state.bounds.maxX <= state.bounds.minX) return
      stopFit()
      fitIfUntouched()
    })
    const settling = new ResizeObserver(fitIfUntouched)
    settling.observe(host)
    // Long enough to outlast the layout settling, short enough that it is not
    // still watching while somebody reads.
    setTimeout(() => settling.disconnect(), 2000)
  }

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

  // The accordion's slide and the go-to-node command are shared with the Vue
  // and React demos — see `demo-behaviour.ts`. Only the delivery differs: a
  // vanilla card is plain DOM with no reference to the chart, so it asks
  // through a CustomEvent; the other two stacks hand their cards a closure.
  const slide = createAccordionSlide(() => chart.api, example)
  const onSlide = (): void => slide.start()

  /**
   * The go-to-node command in one gesture: mark the way from the root, then
   * fly there and flash the ring on arrival. `pathTo` returns the root-to-node
   * id chain, which is exactly what `highlight` wants, and `focus` opens every
   * collapsed ancestor on the way — so this works from a fully closed chart,
   * not only when the target already happens to be on screen.
   */
  const onGoto = (event: Event): void => {
    goTo(chart.api, (event as CustomEvent<{ id: string }>).detail.id)
  }

  /**
   * The sunburst's drill-down, wired from the library's primitives rather than
   * built into it: `setCentre` moves the wheel, `nodeClick` says what was hit,
   * and the parent lookup is the page's own data. Four lines of app code, and
   * every part of it is something an app would want to control — which is why
   * the library ships the pieces rather than the behaviour.
   *
   * Two gestures, and the second is the one that makes it navigable: clicking
   * a segment drills INTO it, and clicking the segment already at the centre
   * steps back OUT to its parent. So the hub is always "go up", which is where
   * a viewer will look for it.
   */
  const drill = createDrill(example, layout)
  const stopHoverTrail = chart.on(
    'nodeHover',
    createHoverTrail(() => chart.api, example),
  )

  const stopDrill = chart.on('nodeClick', ({ id }) => {
    const next = drill(id, chart.api.getCentre())
    if (next === undefined) return
    chart.api.setCentre(next)
    onCentreChange?.(chart.api.getCentre())
  })

  /**
   * The drop log. Deliberately does NOT call `preventDefault()`: the point of
   * this example is that the chart applies the move, and a demo that vetoed
   * every drop would be demonstrating the veto instead.
   */
  let stopDrop: (() => void) | null = null
  if (example.dropControl === true) {
    stopDrop = chart.on('nodeDrop', ({ ids, parentId, mode }) => {
      onDrop?.(dropDetail(example.data, ids, parentId, mode))
    })
  }

  /**
   * Every edit, however it was made.
   *
   * A viewer using `Alt+Up` or `Delete` restructures the tree with nothing in
   * the page told about it — no button was clicked and `nodeDrop` only covers
   * a drag — which left the Edit panel's Undo sitting disabled with something
   * to undo. It also keeps the example's own "who reports to whom" map true,
   * since the reorder rule reads it.
   */
  const stopEdit = chart.on('edit', (change) => {
    if (change.op === 'move') for (const id of change.ids) rememberParent(id, change.parentId)
    else if (change.op === 'add') {
      for (const item of change.items) rememberParent(String(item.id), change.parentId)
    }
    onEdit?.()
  })

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
      slide.stop()
      host.removeEventListener('playground:goto', onGoto)
      stopDrill()
      stopHoverTrail()
      stopDrop?.()
      stopEdit()
      chart.destroy()
    },
    setMinimap(on) {
      minimapOn = on
      // Straight through the API rather than `chart.update()`, so toggling
      // the minimap never resets the tree's expand/collapse state.
      chart.api.setMinimap(minimapOption())
    },
    setMinimapPosition(position) {
      minimapPosition = position
      chart.api.setMinimap(minimapOption())
    },
    setMinimapSilhouette(colour) {
      minimapSilhouette = colour
      chart.api.setMinimap(minimapOption())
    },
    setTheme(partial) {
      chart.api.setTheme(partial)
    },
    setRingEnabled(enabled) {
      chart.api.setRing(enabled)
    },
    setLayoutOptions(settings, fit) {
      chart.api.setLayoutOptions(settings, { fit })
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
      chart.api.setTheme(modeThemeFor(example, layout, next))
      // The minimap's silhouette is the one piece of it the playground's own
      // CSS cannot restyle (see `silhouetteColour` in theme.ts), so it has to
      // be re-applied through the option — but only while the widget is
      // actually showing, since `setMinimap(false)` on an already-hidden
      // minimap would just rebuild nothing.
      if (minimapOn) chart.api.setMinimap(minimapOption())
    },
  }
}
