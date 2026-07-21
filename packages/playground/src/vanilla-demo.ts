import { createOrgChart, type Options } from '@n1crack/orgchart'
import type { Example } from './data.js'

const DEFAULT_NODE_SIZE = { w: 180, h: 64 }

/**
 * Renders the same `<strong>name</strong><small>title</small>` card as the
 * Vue demo, but with plain DOM calls instead of Vue's `render()`. The pooled
 * overlay element is reused across frames (see packages/vanilla/src/overlay.ts),
 * so this only builds the inner nodes once per slot and just updates their
 * text on later frames — rebuilding the subtree every frame would add exactly
 * the DOM churn the pooling exists to avoid.
 */
function renderCard(element: HTMLElement, context: Parameters<NonNullable<Options['renderNode']>>[1]): void {
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

  let toggleBtn = card.querySelector<HTMLButtonElement>('.toggle-btn')
  if (context.hasChildren) {
    if (toggleBtn === null) {
      toggleBtn = document.createElement('button')
      toggleBtn.type = 'button'
      toggleBtn.className = 'toggle-btn'
      card.append(toggleBtn)
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

export function mountVanilla(host: HTMLElement, example: Example) {
  const options: Options = {
    data: example.data,
    nodeSize: DEFAULT_NODE_SIZE,
    label: (item) => String(item.name ?? ''),
    ...example.options,
    renderNode: renderCard,
  }
  return createOrgChart(host, options)
}
