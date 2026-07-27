import type { Tree } from '@klad/engine'

/**
 * The mirror materialises at most this many rows at once. A tree with more than
 * this many VISIBLE nodes is windowed: only a slice of this size, centred on the
 * tab-stop row, is in the DOM at any moment, and keyboard navigation slides the
 * window. iOS WebKit chokes on tens of thousands of persistent DOM nodes (the
 * former behaviour: one row per visible node — 20k rows froze first open and
 * every toggle for ~30s); bounding the DOM is what fixes it. Trees at or below
 * this size are rendered in full, exactly as before.
 */
const WINDOW_MAX_ROWS = 100

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

export interface A11yTree {
  /**
   * `isolate` is the source index the chart is currently re-rooted at, or -1.
   * The mirror has to honour it for the same reason it honours a collapsed
   * node: a screen reader reading out nodes the chart is not showing is a
   * mirror that contradicts what it mirrors.
   */
  update(tree: Tree, open: Uint8Array, labelOf: (index: number) => string, isolate?: number): void
  focusNode(id: string): void
  destroy(): void
}

export interface A11yCallbacks {
  /** Enter or Space on a row. */
  onActivate(id: string): void
  /** The row gained focus; the camera should follow. */
  onFocus(id: string): void
  /**
   * The keyboard equivalent of a drag: `m` picks a node up ("move"), arrows
   * carry the focus somewhere else, and `m` again drops it INTO whatever is
   * focused. Escape puts it back down.
   *
   * `to` is `null` for a cancel. Returns what happened, so this module can say
   * it out loud — a keyboard user gets no drop preview, so the announcement IS
   * the feedback.
   *
   * Only `into`: `before`/`after` are a question about a position between two
   * things, and the row list gives a keyboard user no way to point at a gap.
   * Reparenting is the part that has no other keyboard route at all; ordering
   * within a parent is a job for the host's own UI.
   */
  onMove(id: string, to: string | null): 'moved' | 'refused' | 'cancelled'
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

  /**
   * Where the keyboard-move gesture speaks.
   *
   * A pointer drag has a preview — the outline, the insertion line, the ghost.
   * A keyboard user has none of that, so the announcement is not a courtesy on
   * top of the feedback, it IS the feedback: without it, pressing M twice does
   * something invisible and unconfirmed.
   *
   * `polite` rather than `assertive`: these fire in response to a deliberate
   * keypress, so they will be reached in turn, and interrupting whatever the
   * reader is mid-sentence on would be louder than the event deserves. A
   * sibling of the tree rather than a child, so a row's own subtree is not
   * disturbed by text appearing inside it.
   */
  const live = document.createElement('div')
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('role', 'status')
  live.style.position = 'absolute'
  live.style.width = '1px'
  live.style.height = '1px'
  live.style.overflow = 'hidden'
  live.style.clipPath = 'inset(50%)'
  live.style.whiteSpace = 'nowrap'
  container.appendChild(live)

  const announce = (message: string): void => {
    // Cleared first: an identical string written twice is not a DOM change,
    // and a live region only announces what changed — so "could not be moved"
    // twice in a row would be said once.
    live.textContent = ''
    live.textContent = message
  }

  /** A node's own label, for an announcement. Falls back to the id, exactly
   * as the rows themselves do. */
  const labelFor = (id: string): string => {
    const index = currentTree?.idToIndex.get(id)
    if (index === undefined || currentLabelOf === undefined) return id
    return currentLabelOf(index) || id
  }

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
    tabIndex: 0 | -1
    posinset: string | undefined
    setsize: string | undefined
  }
  const slotState: (SlotState | undefined)[] = []

  /**
   * The single node currently in the tab sequence — the ARIA "roving
   * tabindex" pattern: exactly one row is ever reachable by sequential Tab,
   * everything else is `tabIndex = -1` (still programmatically focusable via
   * `.focus()`, just skipped by Tab). Without this every row would sit in
   * the page's tab order, which at 50,000 nodes is its own accessibility bug.
   *
   * Tracked by node id, not by row/slot, for the same reason DOM focus is
   * tracked by id elsewhere in this file: pooling can reassign a slot to a
   * different node between updates. `undefined` means "no row has ever been
   * focused" — `update()` then defaults the tab stop to the first row so a
   * keyboard user tabbing into the mirror for the first time has *something*
   * to land on.
   */
  let tabbableId: string | undefined

  /** Tree structure retained from the last `update()`, so key handling can
   * resolve "first child" and "parent" — the mirror is a flat list of rows,
   * so those are not adjacency in that list, they require walking the tree
   * itself. */
  let currentTree: Tree | undefined
  let currentOpen: Uint8Array | undefined
  let currentLabelOf: ((index: number) => string) | undefined
  // The visible nodes in preorder, and each node id's position in that sequence.
  // Rebuilt by the cheap pass in `update()`; read by keyboard nav to re-window.
  let visibleSeq: number[] = []
  const seqPosById = new Map<string, number>()
  // The slice of `visibleSeq` currently materialised in the DOM: [windowStart, windowEnd).
  let windowStart = 0
  let windowEnd = 0

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
    // Roving tabindex default: -1 until the main loop in `update()` decides
    // which row (if any) is the current tab stop.
    row.tabIndex = -1
    row.style.contentVisibility = 'auto'
    root.appendChild(row)
    pool.push(row)
    return { row, isNew: true }
  }

  /**
   * Renders exactly visibleSeq[start..end) into pooled rows, diff-writing each
   * row's attributes, shrinking any surplus, and recording [windowStart,
   * windowEnd). `windowed` gates aria-setsize/aria-posinset: written when the
   * tree is windowed (so a screen reader learns the full size and this row's
   * position), removed when it is not. Does NOT touch browser focus — callers
   * (`update`, `focusSeqPos`) handle focus after.
   */
  const materialiseWindow = (start: number, end: number, total: number, windowed: boolean): void => {
    activeCount = 0
    ordered = []
    rowsById.clear()

    for (let pos = start; pos < end; pos++) {
      const index = visibleSeq[pos]!
      const id = currentTree!.indexToId[index]!
      const hasChildren = currentTree!.childStart[index + 1]! > currentTree!.childStart[index]!
      const level = String(currentTree!.depth[index]! + 1)
      const label = currentLabelOf!(index) || id
      const expanded = hasChildren ? (currentOpen![index] === 1 ? 'true' : 'false') : undefined
      const tabIndexValue: 0 | -1 = id === tabbableId ? 0 : -1
      const posinset = windowed ? String(pos + 1) : undefined
      const setsize = windowed ? String(total) : undefined

      const slotIndex = activeCount
      const { row, isNew } = acquire()
      const prev = isNew ? undefined : slotState[slotIndex]

      if (prev === undefined) {
        row.dataset.orgchartId = id
        row.setAttribute('aria-level', level)
        if (expanded !== undefined) row.setAttribute('aria-expanded', expanded)
        if (setsize !== undefined) row.setAttribute('aria-setsize', setsize)
        if (posinset !== undefined) row.setAttribute('aria-posinset', posinset)
        row.textContent = label
        row.tabIndex = tabIndexValue
      } else {
        if (prev.id !== id) row.dataset.orgchartId = id
        if (prev.level !== level) row.setAttribute('aria-level', level)
        if (prev.expanded !== expanded) {
          if (expanded !== undefined) row.setAttribute('aria-expanded', expanded)
          else row.removeAttribute('aria-expanded')
        }
        if (prev.setsize !== setsize) {
          if (setsize !== undefined) row.setAttribute('aria-setsize', setsize)
          else row.removeAttribute('aria-setsize')
        }
        if (prev.posinset !== posinset) {
          if (posinset !== undefined) row.setAttribute('aria-posinset', posinset)
          else row.removeAttribute('aria-posinset')
        }
        if (prev.label !== label) row.textContent = label
        if (prev.tabIndex !== tabIndexValue) row.tabIndex = tabIndexValue
      }

      slotState[slotIndex] = { id, level, expanded, label, tabIndex: tabIndexValue, posinset, setsize }
      rowsById.set(id, row)
      ordered.push(row)
      activeCount++
    }

    for (let i = activeCount; i < pool.length; i++) pool[i]!.remove()
    windowStart = start
    windowEnd = end
  }

  /**
   * Chooses a window of up to WINDOW_MAX_ROWS centred on `anchorPos` and returns
   * its [start, end). Below the threshold the window is the whole sequence.
   */
  const windowFor = (anchorPos: number, total: number): { start: number; end: number; windowed: boolean } => {
    if (total <= WINDOW_MAX_ROWS) return { start: 0, end: total, windowed: false }
    const start = clamp(anchorPos - (WINDOW_MAX_ROWS >> 1), 0, total - WINDOW_MAX_ROWS)
    return { start, end: start + WINDOW_MAX_ROWS, windowed: true }
  }

  /**
   * Moves focus to the node at sequence position `pos`, re-windowing first if that
   * node is outside the currently materialised window. This is what lets keyboard
   * navigation traverse the entire visible sequence when only a window is ever in
   * the DOM.
   */
  const focusSeqPos = (pos: number): void => {
    if (currentTree === undefined) return
    const total = visibleSeq.length
    if (total === 0) return
    const p = clamp(pos, 0, total - 1)
    if (p < windowStart || p >= windowEnd) {
      const w = windowFor(p, total)
      materialiseWindow(w.start, w.end, total, w.windowed)
    }
    const id = currentTree.indexToId[visibleSeq[p]!]!
    rowsById.get(id)?.focus()
  }

  /** The node currently picked up by the keyboard, or `null`. */
  let grabbed: string | null = null

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement
    const id = target.dataset.orgchartId
    if (id === undefined) return
    const pos = seqPosById.get(id)

    if (event.key === 'm' || event.key === 'M') {
      event.preventDefault()
      if (grabbed === null) {
        grabbed = id
        announce(`${labelFor(id)} picked up. Move to a node and press M to drop it there, or Escape to cancel.`)
      } else {
        const from = grabbed
        grabbed = null
        const result = callbacks.onMove(from, id)
        announce(
          result === 'moved'
            ? `${labelFor(from)} moved into ${labelFor(id)}.`
            : `${labelFor(from)} could not be moved into ${labelFor(id)}.`,
        )
      }
      return
    }
    if (event.key === 'Escape' && grabbed !== null) {
      event.preventDefault()
      const from = grabbed
      grabbed = null
      callbacks.onMove(from, null)
      announce(`${labelFor(from)} put back.`)
      return
    }

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault()
        callbacks.onActivate(id)
        break
      case 'ArrowDown':
        event.preventDefault()
        if (pos !== undefined) focusSeqPos(pos + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (pos !== undefined) focusSeqPos(pos - 1)
        break
      case 'Home':
        event.preventDefault()
        focusSeqPos(0)
        break
      case 'End':
        event.preventDefault()
        focusSeqPos(visibleSeq.length - 1)
        break
      case 'ArrowRight':
        event.preventDefault()
        expandOrMoveToFirstChild(id)
        break
      case 'ArrowLeft':
        event.preventDefault()
        collapseOrMoveToParent(id)
        break
    }
  }

  /**
   * ArrowRight, ARIA tree pattern: a collapsed node expands (focus stays put
   * — expanding is the whole action); an already-expanded node instead moves
   * focus to its first child; a leaf does nothing.
   *
   * `currentTree`/`currentOpen` are read fresh from the last `update()`
   * rather than anything captured earlier, and `rowsById` likewise reflects
   * that same last update — so a child row looked up here is one that
   * exists *right now*, never a stale reference from before some earlier
   * rebuild.
   */
  const expandOrMoveToFirstChild = (id: string): void => {
    if (currentTree === undefined || currentOpen === undefined) return
    const index = currentTree.idToIndex.get(id)
    if (index === undefined) return
    const hasChildren = currentTree.childStart[index + 1]! > currentTree.childStart[index]!
    if (!hasChildren) return
    if (currentOpen[index] !== 1) {
      // Collapsed: expand it. `onActivate` is the same toggle Enter/Space
      // already uses; calling it here is safe precisely because this branch
      // only runs when the node is known to be collapsed, so the toggle can
      // only move it one way — open.
      callbacks.onActivate(id)
      return
    }
    // Already expanded: move to the first child. The row for it already
    // exists (the mirror lists every node regardless of expand state — only
    // `aria-expanded` reflects collapse, never row presence, so a single
    // toggle never costs a rebuild), so this is a plain synchronous focus
    // move, no rebuild to wait for.
    const firstChild = currentTree.childIndex[currentTree.childStart[index]!]
    if (firstChild === undefined) return
    const childId = currentTree.indexToId[firstChild]!
    const childPos = seqPosById.get(childId)
    if (childPos !== undefined) focusSeqPos(childPos)
  }

  /**
   * ArrowLeft, ARIA tree pattern: an expanded node collapses (focus stays
   * put); a collapsed node or a leaf instead moves focus to its parent; a
   * root has no parent, so that case is a no-op rather than throwing or
   * moving focus somewhere arbitrary.
   */
  const collapseOrMoveToParent = (id: string): void => {
    if (currentTree === undefined || currentOpen === undefined) return
    const index = currentTree.idToIndex.get(id)
    if (index === undefined) return
    const hasChildren = currentTree.childStart[index + 1]! > currentTree.childStart[index]!
    const expanded = hasChildren && currentOpen[index] === 1
    if (expanded) {
      // Same reasoning as the mirror-image branch above: only reached when
      // the node is known to be expanded, so the toggle can only collapse it.
      callbacks.onActivate(id)
      return
    }
    const parentIndex = currentTree.parent[index]!
    if (parentIndex === -1) return // a root has no parent
    const parentId = currentTree.indexToId[parentIndex]!
    const parentPos = seqPosById.get(parentId)
    if (parentPos !== undefined) focusSeqPos(parentPos)
  }

  const onFocusIn = (event: FocusEvent): void => {
    const row = event.target as HTMLElement
    const id = row.dataset.orgchartId
    if (id === undefined) return
    // Roving tabindex: whichever row focus just landed on becomes the one
    // tab stop, and the row that held that title before (if any, and if it
    // still exists) steps out of the tab order. Every focus move in this
    // file — arrow keys, Home/End, `focusNode`, and a plain Tab from outside
    // — funnels through this one handler, so this is the single place that
    // needs to enforce it.
    if (tabbableId !== id) {
      const previous = tabbableId === undefined ? undefined : rowsById.get(tabbableId)
      if (previous !== undefined) previous.tabIndex = -1
      row.tabIndex = 0
      tabbableId = id
    }
    callbacks.onFocus(id)
  }

  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('focusin', onFocusIn)

  return {
    update(tree, open, labelOf, isolate = -1) {
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

      currentTree = tree
      currentOpen = open
      currentLabelOf = labelOf

      // Roving tabindex target for this render: keep whatever node last held
      // the tab stop, provided it still exists in this tree — otherwise fall
      // back to the first row, the same default the ARIA tree pattern uses
      // for a tree nobody has focused yet.
      const effectiveTabbableId =
        tabbableId !== undefined && tree.idToIndex.has(tabbableId)
          ? tabbableId
          : tree.count > 0
            ? tree.indexToId[tree.order[0]!]!
            : undefined
      tabbableId = effectiveTabbableId

      // Cheap pass: visibility + the visible preorder sequence, no DOM. A
      // collapsed node's descendants must not appear in the mirror at all —
      // leaving them in while flipping only `aria-expanded` makes the mirror
      // contradict itself: a screen reader announces the node as collapsed
      // and then reads the children it just said were hidden. Costs nothing
      // extra — this loop already walks every node, and preorder guarantees
      // a parent is decided before its children, so visibility resolves in
      // the same pass.
      visibleSeq = []
      seqPosById.clear()
      const visible = new Uint8Array(tree.count)
      for (let k = 0; k < tree.count; k++) {
        const index = tree.order[k]!
        const parent = tree.parent[index]!
        // Same rule as `pruneToVisible`: the isolate root is visible whatever
        // its parent says, any other genuine root is not, and everything else
        // resolves through its parent as usual.
        const isVisible =
          index === isolate
            ? true
            : parent === -1
              ? isolate === -1
              : visible[parent] === 1 && open[parent] === 1
        visible[index] = isVisible ? 1 : 0
        if (!isVisible) continue
        seqPosById.set(tree.indexToId[index]!, visibleSeq.length)
        visibleSeq.push(index)
      }

      const total = visibleSeq.length
      const anchorPos = effectiveTabbableId !== undefined ? (seqPosById.get(effectiveTabbableId) ?? 0) : 0
      const w = windowFor(anchorPos, total)
      materialiseWindow(w.start, w.end, total, w.windowed)

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
      const pos = seqPosById.get(id)
      if (pos !== undefined) focusSeqPos(pos)
    },

    destroy() {
      root.removeEventListener('keydown', onKeyDown)
      live.remove()
      root.removeEventListener('focusin', onFocusIn)
      root.remove()
      rowsById.clear()
      ordered = []
      pool.length = 0
      slotState.length = 0
      activeCount = 0
      tabbableId = undefined
      currentTree = undefined
      currentOpen = undefined
      currentLabelOf = undefined
      visibleSeq = []
      seqPosById.clear()
      windowStart = 0
      windowEnd = 0
    },
  }
}
