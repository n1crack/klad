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
 *
 * Rows are pooled and reused positionally, exactly as `overlay.ts` reuses its
 * slots: `update()` rewrites an existing row's text and ARIA attributes in
 * place instead of clearing the mirror and re-appending every row. A field
 * that hasn't changed since the last update is left untouched — writing an
 * unchanged value to a DOM attribute still costs a style invalidation, so the
 * diff has to skip the write, not just make it cheaper.
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

  // `pool[i]` is the row currently sitting at document position `i`, once it
  // has been attached at least once. `activeCount` is how many of them were
  // "live" (assigned to a node) as of the last `update()` — the rest, if any,
  // are detached but kept around in `pool` for the next growth to reclaim.
  const pool: HTMLElement[] = []
  let activeCount = 0
  const rowsById = new Map<string, HTMLElement>()
  let ordered: HTMLElement[] = []

  /**
   * What `pool[i]` was last written with, indexed the same way as `pool`.
   * The diff below compares against these plain JS strings instead of
   * reading the row's current `dataset`/attribute/`textContent` back out of
   * the DOM: a DOM read still crosses into native code, so on a 10k-row tree
   * where at most a handful of rows actually changed, comparing cached
   * strings is measurably cheaper than comparing against DOM reads for
   * every unchanged row.
   */
  interface SlotState {
    id: string
    level: string
    expanded: string | undefined
    label: string
  }
  const slotState: (SlotState | undefined)[] = []

  /**
   * `isNew` tells the caller whether the row was just created. A brand new
   * row has no prior label/level/expanded state to diff against, so the
   * caller can skip the read-then-compare a reused row needs and write
   * straight through — otherwise every cold "populate from nothing" call
   * (the very first render, or a structurally new tree) pays a redundant
   * read for every attribute it is about to set unconditionally anyway.
   */
  const acquire = (): { row: HTMLElement; isNew: boolean } => {
    const existing = pool[activeCount]
    if (existing !== undefined) {
      // Detached by a previous shrink (see the tail loop in `update` below),
      // not destroyed: the element object is the same one `rowsById`/`ordered`
      // may still reference, so reattaching it is correct where recreating it
      // would not be.
      if (existing.parentNode !== root) root.appendChild(existing)
      return { row: existing, isNew: false }
    }
    const row = document.createElement('div')
    row.setAttribute('role', 'treeitem')
    row.tabIndex = 0
    row.style.contentVisibility = 'auto'
    root.appendChild(row)
    pool.push(row)
    return { row, isNew: true }
  }

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
      // Focus preservation. A full rebuild used to destroy the focused
      // element outright, so focus fell back to the body — an acceptable if
      // unfriendly default. Pooling introduces a sharper hazard: a row can be
      // *reused* for a different node while it still holds browser focus, so
      // without this the row would keep reporting as focused while silently
      // announcing someone else's name. The fix is that focus follows the
      // node, not the slot: capture which node (if any) is focused before the
      // diff, then after the diff either re-point focus at that node's new
      // row (if it moved slots) or drop focus (if the node is gone).
      const activeElement = document.activeElement
      const focusedId =
        activeElement instanceof HTMLElement && activeElement.parentNode === root
          ? activeElement.dataset.orgchartId
          : undefined

      activeCount = 0
      ordered = []
      rowsById.clear()

      for (let k = 0; k < tree.count; k++) {
        const index = tree.order[k]!
        const id = tree.indexToId[index]!
        const hasChildren = tree.childStart[index + 1]! > tree.childStart[index]!
        const level = String(tree.depth[index]! + 1)
        const label = labelOf(index) || id
        const expanded = hasChildren ? (open[index] === 1 ? 'true' : 'false') : undefined

        const slotIndex = activeCount
        const { row, isNew } = acquire()
        const prev = isNew ? undefined : slotState[slotIndex]

        if (prev === undefined) {
          // Nothing to diff against yet — either the row was just created,
          // or (defensively) its slot state wasn't recorded — so every field
          // is being set for the first time. Write straight through rather
          // than reading each one back first only to find it unset.
          row.dataset.orgchartId = id
          row.setAttribute('aria-level', level)
          if (expanded !== undefined) row.setAttribute('aria-expanded', expanded)
          row.textContent = label
        } else {
          if (prev.id !== id) row.dataset.orgchartId = id
          if (prev.level !== level) row.setAttribute('aria-level', level)
          if (prev.expanded !== expanded) {
            if (expanded !== undefined) {
              row.setAttribute('aria-expanded', expanded)
            } else {
              // A leaf claiming to be collapsible misleads a screen reader
              // user; this only fires when a node actually lost its children.
              row.removeAttribute('aria-expanded')
            }
          }
          if (prev.label !== label) row.textContent = label
        }

        slotState[slotIndex] = { id, level, expanded, label }
        rowsById.set(id, row)
        ordered.push(row)
        activeCount++
      }

      // Shrink: detach the surplus rather than discard it. `acquire` reclaims
      // these same elements the next time the tree grows, exactly as
      // `overlay.ts` reclaims its idle slots.
      for (let i = activeCount; i < pool.length; i++) {
        pool[i]!.remove()
      }

      if (focusedId !== undefined) {
        const nextRow = rowsById.get(focusedId)
        if (nextRow === undefined) {
          // The focused node no longer exists. The row that used to show it
          // may still be attached — just repurposed for whatever node landed
          // in that slot — so leaving focus on it would strand a keyboard
          // user on the wrong node with no signal anything changed. Blur it;
          // focus falls back the same way a full rebuild used to.
          if (activeElement instanceof HTMLElement) activeElement.blur()
        } else if (nextRow !== activeElement) {
          // The node is still here but a different slot now represents it —
          // move browser focus there so it keeps following the node.
          nextRow.focus()
        }
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
      pool.length = 0
      slotState.length = 0
      activeCount = 0
    },
  }
}
