import type { Tree } from '@n1crack/orgchart-core'

export interface A11yTree {
  update(tree: Tree, open: Uint8Array, labelOf: (index: number) => string): void
  focusNode(id: string): void
  destroy(): void
}

export interface A11yCallbacks {
  /** Enter or Space on a row. */
  onActivate(id: string): void
  /** The row gained focus; the camera should follow. */
  onFocus(id: string): void
}

/**
 * A real DOM mirror of the chart, for screen readers and keyboard users.
 *
 * Visually hidden via clipping rather than `display: none` — the latter removes
 * it from the accessibility tree, which would defeat the entire purpose.
 * `content-visibility: auto` keeps offscreen rows off the layout bill, so 50k
 * rows stay affordable.
 */
export function createA11yTree(container: HTMLElement, callbacks: A11yCallbacks): A11yTree {
  const root = document.createElement('div')
  root.setAttribute('role', 'tree')
  root.style.position = 'absolute'
  root.style.width = '1px'
  root.style.height = '1px'
  root.style.overflow = 'hidden'
  root.style.clipPath = 'inset(50%)'
  root.style.whiteSpace = 'nowrap'
  container.appendChild(root)

  const rowsById = new Map<string, HTMLElement>()
  let ordered: HTMLElement[] = []

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement
    const id = target.dataset.orgchartId
    if (id === undefined) return
    const position = ordered.indexOf(target)

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault()
        callbacks.onActivate(id)
        break
      case 'ArrowDown':
        event.preventDefault()
        ordered[Math.min(ordered.length - 1, position + 1)]?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        ordered[Math.max(0, position - 1)]?.focus()
        break
      case 'Home':
        event.preventDefault()
        ordered[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        ordered[ordered.length - 1]?.focus()
        break
    }
  }

  const onFocusIn = (event: FocusEvent): void => {
    const id = (event.target as HTMLElement).dataset.orgchartId
    if (id !== undefined) callbacks.onFocus(id)
  }

  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('focusin', onFocusIn)

  return {
    update(tree, open, labelOf) {
      root.textContent = ''
      rowsById.clear()
      ordered = []

      for (let k = 0; k < tree.count; k++) {
        const index = tree.order[k]!
        const id = tree.indexToId[index]!
        const hasChildren = tree.childStart[index + 1]! > tree.childStart[index]!

        const row = document.createElement('div')
        row.setAttribute('role', 'treeitem')
        row.setAttribute('aria-level', String(tree.depth[index]! + 1))
        if (hasChildren) row.setAttribute('aria-expanded', open[index] === 1 ? 'true' : 'false')
        row.tabIndex = 0
        row.dataset.orgchartId = id
        row.style.contentVisibility = 'auto'
        row.textContent = labelOf(index) || id

        root.appendChild(row)
        rowsById.set(id, row)
        ordered.push(row)
      }
    },

    focusNode(id) {
      rowsById.get(id)?.focus()
    },

    destroy() {
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('focusin', onFocusIn)
      root.remove()
      rowsById.clear()
      ordered = []
    },
  }
}
