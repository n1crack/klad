import { openOverflowPanel } from './overflow-panel.js'
import { toggleWatching, WIDE_WATCHING } from './data.js'

/** What `NodeContext.overflow` carries, as far as this module needs it. */
export interface OverflowInfo {
  count: number
  ids: string[]
  items: { id: string; [key: string]: unknown }[]
}

/**
 * The text on the node a capped level rolled its remainder into.
 *
 * Deliberately not "show them all": a level of a hundred is the problem the
 * cap is solving, and a button straight back to it is that problem with an
 * invitation attached. What the click does instead is open a list you can
 * search and pick from — see `overflow-panel.ts`.
 */
export function overflowLabel(over: { count: number }): string {
  return `+${over.count} more`
}

/** Opens the picker for one aggregate node. Shared by all three stacks: what
 * it builds is a DOM list widget, and three copies of a virtual list is three
 * places for it to drift. */
export function openPickerFor(anchor: HTMLElement, over: OverflowInfo): void {
  openOverflowPanel({
    anchor,
    items: over.items.map((item) => ({ id: String(item.id), label: String(item.name ?? item.id) })),
    checked: WIDE_WATCHING,
    onToggle: toggleWatching,
  })
}
