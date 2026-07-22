import { createOrgChart, type Options } from '@n1crack/orgchart'
import { DEPARTMENT_COLOR, initials, type Department, type Example, type NodeContentKind } from './data.js'

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
 * Round initials monogram with a department-coloured ring, name below it
 * (not inside it) — data-driven styling (the ring colour reads `department`,
 * same as the status card) plus `cursor: pointer` since the whole node is
 * the toggle (toggleOnNodeClick: true, no button — there's no room for one).
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
  // badge row. The toolbar's Expand All / Collapse All still work.
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

export function mountVanilla(host: HTMLElement, example: Example) {
  const renderNode = RENDERERS[example.content]
  const options: Options = {
    data: example.data,
    nodeSize: DEFAULT_NODE_SIZE,
    label: (item) => String(item.name ?? ''),
    ...example.options,
    ...(renderNode !== null ? { renderNode } : {}),
  }
  return createOrgChart(host, options)
}
