/**
 * The picker that opens from the node a capped level rolled its remainder
 * into.
 *
 * Plain DOM on purpose, shared by all three stacks. What it is is a list
 * widget anchored to a card; nothing about it is React's or Vue's business,
 * and three copies of a virtual list is three places for it to be subtly
 * different.
 *
 * Two things it deliberately does NOT offer:
 *
 *  - "Show them all". A level of four hundred is unreadable, which is the
 *    whole reason the cap exists; an escape hatch straight back to unreadable
 *    is not a feature, it is the problem with a button on it.
 *  - The whole list in the DOM. Four hundred rows built on open makes the
 *    click feel broken. Only the dozen or so in view exist, and the scroll
 *    height is faked — see `ROW_H`.
 *
 * Checking a row pins that node, so it survives the cap from then on; the
 * checked ones sort to the top so the working set stays together as the
 * search narrows.
 */

/** Row height in px. Fixed rather than measured: a virtual list needs to know
 * where row N is without having built rows 0..N-1, and that is only possible
 * if they are all the same. */
const ROW_H = 28
/** How many rows past the viewport to build on each side, so a fast scroll
 * does not show empty space before the next frame catches up. */
const OVERSCAN = 4

export interface OverflowPanelItem {
  id: string
  label: string
}

export interface OverflowPanelOptions {
  /**
   * What a row does.
   *
   * `check` — a checkbox per row; ticking one calls `onToggle` and the panel
   * stays open, because curating a set is several decisions in a row.
   * `pick` — a button per row; choosing one calls `onPick` and the panel
   * closes, because going somewhere is one decision and then you want to look
   * at where you went.
   */
  mode?: 'check' | 'pick'
  /** `pick` only. */
  onPick?(id: string): void
  /** Placement hint for the search box and the count. */
  label?: string
  /** The card the panel hangs off. Used for placement only. */
  anchor: HTMLElement
  items: OverflowPanelItem[]
  /**
   * What the chart is showing. Ticked, and sorted to the top.
   *
   * Read live rather than copied: ticking a row mutates this set and the chart
   * is rebuilt from it, so a snapshot would leave the panel disagreeing with
   * the chart the moment anything changed.
   */
  checked?: Set<string>
  /** A row was checked or unchecked. The panel does not update itself from
   * this — the chart rebuilds, and whoever owns the working set decides. */
  onToggle?(id: string, next: boolean): void
}

let open: (() => void) | null = null

/** Closes whatever panel is open, if any. */
export function closeOverflowPanel(): void {
  open?.()
}

export function openOverflowPanel(options: OverflowPanelOptions): void {
  closeOverflowPanel()

  const root = document.createElement('div')
  root.className = 'overflow-panel'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', `${options.items.length} more`)

  const head = document.createElement('div')
  head.className = 'overflow-panel-head'
  const search = document.createElement('input')
  search.type = 'search'
  search.className = 'overflow-panel-search'
  search.placeholder = `${options.label ?? 'Search'} ${options.items.length}…`
  search.setAttribute('aria-label', 'Search the hidden nodes')
  const count = document.createElement('span')
  count.className = 'overflow-panel-count'
  head.append(search, count)

  const scroller = document.createElement('div')
  scroller.className = 'overflow-panel-list'
  // The full height the list WOULD have, so the scrollbar is honest about how
  // much there is even though almost none of it exists.
  const sizer = document.createElement('div')
  sizer.className = 'overflow-panel-sizer'
  const rows = document.createElement('div')
  rows.className = 'overflow-panel-rows'
  sizer.append(rows)
  scroller.append(sizer)

  const hint = document.createElement('p')
  hint.className = 'overflow-panel-hint'
  hint.textContent = options.mode === 'pick' ? 'Choose one to go there.' : 'Checked is what the chart shows.'

  root.append(head, scroller, hint)
  document.body.append(root)

  /** Checked first, then the data's own order. Recomputed per query rather
   * than kept sorted, because checking a row has to move it. */
  const ordered = (query: string): OverflowPanelItem[] => {
    const needle = query.trim().toLowerCase()
    const match =
      needle === ''
        ? options.items
        : options.items.filter((item) => item.label.toLowerCase().includes(needle))
    const on: OverflowPanelItem[] = []
    const off: OverflowPanelItem[] = []
    const checked = options.checked
    for (const item of match) (checked?.has(item.id) === true ? on : off).push(item)
    return [...on, ...off]
  }

  let visible = ordered('')

  const paint = (): void => {
    sizer.style.height = `${visible.length * ROW_H}px`
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_H) - OVERSCAN)
    const span = Math.ceil(scroller.clientHeight / ROW_H) + OVERSCAN * 2
    const last = Math.min(visible.length, first + span)
    rows.style.transform = `translateY(${first * ROW_H}px)`
    rows.replaceChildren()
    for (let i = first; i < last; i++) {
      const item = visible[i]!
      if (options.mode === 'pick') {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'overflow-panel-row is-pick'
        button.style.height = `${ROW_H}px`
        button.textContent = item.label
        button.onclick = () => {
          options.onPick?.(item.id)
          closeOverflowPanel()
        }
        rows.append(button)
        continue
      }
      const row = document.createElement('label')
      row.className = 'overflow-panel-row'
      row.style.height = `${ROW_H}px`
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = options.checked?.has(item.id) === true
      box.onchange = () => {
        options.onToggle?.(item.id, box.checked)
        // Re-sorted, so a node just checked joins the group at the top rather
        // than staying wherever the search left it.
        visible = ordered(search.value)
        paint()
      }
      const text = document.createElement('span')
      text.textContent = item.label
      row.append(box, text)
      rows.append(row)
    }
    count.textContent = `${visible.length}`
  }

  search.oninput = () => {
    visible = ordered(search.value)
    scroller.scrollTop = 0
    paint()
  }
  scroller.onscroll = paint

  // Placed after it is in the document, so its own size is known. Flipped
  // above the card when there is no room below, and clamped to the viewport
  // so a card near an edge does not push it off screen.
  const rect = options.anchor.getBoundingClientRect()
  const size = root.getBoundingClientRect()
  const below = rect.bottom + 6
  const top = below + size.height > window.innerHeight ? Math.max(6, rect.top - size.height - 6) : below
  root.style.top = `${top}px`
  root.style.left = `${Math.min(Math.max(6, rect.left), window.innerWidth - size.width - 6)}px`

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeOverflowPanel()
  }
  const onDown = (event: PointerEvent): void => {
    if (root.contains(event.target as Node)) return
    closeOverflowPanel()
    // The tap that dismisses a popover dismisses it and nothing else. Without
    // this the same press reaches the chart underneath and starts a pan — and
    // if anything then eats its `pointerup`, the chart is left following the
    // finger with no way out. Capture phase is what makes stopping it here
    // enough: the chart's own listener never sees it.
    event.stopPropagation()
  }
  // `pointerdown` on the window rather than a click on a backdrop: a backdrop
  // would swallow the pan and zoom the chart underneath still wants.
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onDown, true)

  open = () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('pointerdown', onDown, true)

    // Let go of focus BEFORE the element goes, and take the element out on the
    // next task rather than inside the event that closed it.
    //
    // Both are for iOS. Removing the node that holds the focused input, from
    // inside a `pointerdown`, leaves Safari trying to scroll a element that no
    // longer exists into view while it is also dismissing the on-screen
    // keyboard — which locks the page rather than throwing. Blurring first
    // means the keyboard is already on its way out, and deferring means the
    // gesture that triggered this finishes against a document that still makes
    // sense.
    const focused = document.activeElement
    if (focused instanceof HTMLElement && root.contains(focused)) focused.blur()
    root.style.pointerEvents = 'none'
    setTimeout(() => root.remove(), 0)
    open = null
  }

  paint()
  search.focus()
}
