/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Klad,
  type KladApi,
  type KladHandle,
  type LayoutSettings,
  type NodeContext,
  type Options,
  type Theme,
} from '@klad/react'
import {
  DEPARTMENT_COLOR,
  EDGE_RADIUS_DEFAULT,
  initials,
  minimapDefaultOn,
  minimapDefaultPosition,
  accordionProgress,
  minimapOptionFor,
  modeThemeFor,
  dropDetail,
  rowFields,
  isBranchRow,
  optionsForLayout,
  contentForLayout,
  themeFor,
  type Department,
  type Example,
  type LayoutName,
  type MinimapPosition,
  DEPARTMENT_GLYPH,
  SHARED_DATA,
  slotBranchColour,
} from './data.js'
import { createAccordionSlide, createDrill, createHoverTrail, goTo } from './demo-behaviour.js'
import type { ThemeMode } from './theme.js'
import { openPickerFor, overflowLabel } from './overflow-card.js'

const DEFAULT_NODE_SIZE = { w: 180, h: 64 }

type Item = NodeContext['item']

// Mirrors VueDemo.vue's departmentOf/departmentColor/photoGradient/headcountOf
// and the vanilla demo's renderAvatar/renderStatus/renderPhoto, so all three
// stacks land on the same colours for the same department and the same
// values in the same badges — the point of the playground is that the three
// are directly comparable.
function departmentOf(item: Item): Department {
  return (item.department as Department | undefined) ?? 'Executive'
}
function departmentColor(item: Item): string {
  return DEPARTMENT_COLOR[departmentOf(item)]
}
function photoGradient(item: Item): string {
  const colour = departmentColor(item)
  return `linear-gradient(155deg, ${colour}, color-mix(in srgb, ${colour} 55%, black))`
}
function headcountOf(item: Item): number {
  return Number(item.headcount ?? 0)
}

function ToggleButton({ hasChildren, open, toggle }: NodeContext): ReactNode {
  if (!hasChildren) return null
  return (
    <button type="button" className="toggle-btn" onClick={toggle}>
      {open ? '−' : '+'}
    </button>
  )
}

function renderCard(context: NodeContext): ReactNode {
  const item = context.item
  const over = context.overflow
  const id = context.id
  if (over !== null) {
    // The picker is plain DOM shared by all three stacks — see
    // `overflow-card.ts`. A React copy of a virtual list would be a second
    // place for it to drift.
    return (
      <div className="card is-overflow" onClick={(event) => openPickerFor(event.currentTarget, over, id)}>
        <strong>{overflowLabel(over)}</strong>
        <small>Click to search and pick</small>
      </div>
    )
  }
  return (
    <div className={`card${context.loading ? ' is-loading' : ''}`}>
      <strong>{String(item.name ?? '')}</strong>
      <small>{String(item.title ?? '')}</small>
      <ToggleButton {...context} />
    </div>
  )
}

function renderAvatar(context: NodeContext): ReactNode {
  const item = context.item
  return (
    <div className="avatar-card">
      <div className="avatar-circle" style={{ background: departmentColor(item) }}>
        {initials(String(item.name ?? ''))}
      </div>
      <div className="avatar-text">
        <strong>{String(item.name ?? '')}</strong>
        <small>{String(item.title ?? '')}</small>
      </div>
      <ToggleButton {...context} />
    </div>
  )
}

function renderMonogram(context: NodeContext): ReactNode {
  const item = context.item
  const style = { '--accent': departmentColor(item) } as CSSProperties
  return (
    <div className="monogram-card" style={style}>
      <div className="monogram-circle">{initials(String(item.name ?? ''))}</div>
      <span className="monogram-name">{String(item.name ?? '')}</span>
      <ToggleButton {...context} />
    </div>
  )
}

function renderStatus(context: NodeContext): ReactNode {
  const item = context.item
  const department = departmentOf(item)
  const headcount = headcountOf(item)
  const style = { '--accent': departmentColor(item) } as CSSProperties
  return (
    <div className="status-card" style={style}>
      <strong>{String(item.name ?? '')}</strong>
      <small>{String(item.title ?? '')}</small>
      <div className="status-badges">
        <span className="badge badge-dept">{department}</span>
        {headcount > 0 && (
          <span className="badge badge-count">
            {headcount} report{headcount === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The showcase card — a stadium ("slot", as a technical drawing means it) with
 * the branch's own colour on its leading edge. Same accent the chart paints
 * that branch's connectors with (see `slotBranchColour`), so the card and the
 * line arriving at it agree by construction. The hover lift is CSS; the canvas
 * lights the route (see the `nodeHover` wiring).
 */
function renderSlot(context: NodeContext): ReactNode {
  const item = context.item
  const accent = slotBranchColour(SHARED_DATA, String(item.id))
  const style = { '--accent': accent ?? 'var(--slot-hub)' } as CSSProperties
  const classes = ['slot-card']
  if (accent === null) classes.push('is-hub')
  if (context.hasChildren) classes.push('has-children')
  if (context.open) classes.push('is-open')
  if (context.depth === 0) classes.push('is-root')
  return (
    <div className={classes.join(' ')} style={style}>
      <span className="slot-wash" />
      <span className="slot-icon">{DEPARTMENT_GLYPH[departmentOf(item)]}</span>
      <div className="slot-text">
        <span className="slot-kind">{departmentOf(item)}</span>
        <span className="slot-role">{String(item.title ?? '')}</span>
        <span className="slot-name">{String(item.name ?? '')}</span>
      </div>
      <span className="slot-more">{headcountOf(item) > 0 ? headcountOf(item) : ''}</span>
    </div>
  )
}

function renderPhoto(context: NodeContext): ReactNode {
  const item = context.item
  return (
    <div className="photo-tile">
      <div className="photo-image" style={{ background: photoGradient(item) }}>
        <span>{initials(String(item.name ?? ''))}</span>
      </div>
      <div className="photo-caption">
        <strong>{String(item.name ?? '')}</strong>
        <small>{String(item.title ?? '')}</small>
      </div>
      <ToggleButton {...context} />
    </div>
  )
}

/** One indented row — see `renderRow` in vanilla-demo.ts for what each part
 * does and why the canvas underneath draws nothing. Fields come from
 * `rowFields` so any dataset the layout picker points at renders sensibly. */
function renderRow(context: NodeContext): ReactNode {
  const fields = rowFields(context.item, context.open)
  return (
    <div className={`file-row${isBranchRow(context.item, context.hasChildren) ? ' is-folder' : ''}`}>
      <button
        type="button"
        className={`file-chevron${context.open ? ' is-open' : ''}`}
        disabled={!context.hasChildren}
        aria-hidden={!context.hasChildren}
        onClick={(event) => {
          event.stopPropagation()
          context.toggle()
        }}
      >
        {context.hasChildren ? '▸' : ''}
      </button>
      <span
        className={`file-icon${fields.iconColour === '' ? '' : ' is-chip'}`}
        style={fields.iconColour === '' ? undefined : { background: fields.iconColour }}
      >
        {fields.icon}
      </span>
      <span className="file-name">{fields.primary}</span>
      <span className="file-size">{fields.secondary}</span>
    </div>
  )
}

/**
 * Subtree counts. Every number is an array lookup the chart precomputed — see
 * `NodeStats` in the vanilla package — not a walk, which at one walk per node
 * per frame is exactly the shape of work a large chart cannot afford.
 */
/** See `renderBounds` in vanilla-demo.ts — the placement is the explanation. */
function renderBounds(context: NodeContext): ReactNode {
  const item = context.item
  return (
    <div className="bounds-card">
      <span className="bounds-lft">{context.lft}</span>
      <div className="bounds-body">
        <strong>{String(item.name ?? '')}</strong>
        <small>{context.descendants === 0 ? 'leaf' : `${context.descendants} below`}</small>
      </div>
      <span className="bounds-rgt">{context.rgt}</span>
      <ToggleButton {...context} />
    </div>
  )
}

function renderCounts(context: NodeContext): ReactNode {
  const item = context.item
  const style = { '--accent': departmentColor(item) } as CSSProperties
  const cells: [kind: string, value: string, title: string][] = [
    ['direct', String(context.directChildren), 'Direct reports'],
    ['total', String(context.descendants), 'Everyone below, at any depth'],
    ['depth', `L${context.depth}`, 'Levels below the root'],
    ['height', `↓${context.height}`, 'How deep this subtree runs'],
  ]
  return (
    <div className="counts-card" style={style}>
      <strong>{String(item.name ?? '')}</strong>
      <small>{String(item.title ?? '')}</small>
      <div className="counts-row">
        {cells.map(([kind, value, title]) => (
          <span key={kind} className={`count count-${kind}`} title={title}>
            {value}
          </span>
        ))}
      </div>
      <ToggleButton {...context} />
    </div>
  )
}

const ROLE_OPTIONS = ['Owner', 'Reviewer', 'Observer'] as const

/**
 * A card carrying a real `<select>`.
 *
 * The overlay is an absolutely-positioned DOM layer over a canvas, and a form
 * control living in it has to keep behaving normally: opening the menu must
 * not pan the chart. `stopPropagation` on the pointer is all it takes — the
 * vanilla layer already treats genuinely interactive elements as theirs.
 *
 * The value is written back onto the node's own data rather than held in React
 * state, and that is not laziness: the overlay pools its elements, so this
 * component is unmounted and remounted against a different node as the camera
 * moves. State would travel with the slot; the data travels with the node.
 */
function renderDropdown(context: NodeContext): ReactNode {
  const item = context.item
  return (
    <div className="dropdown-card">
      <div className="dropdown-text">
        <strong>{String(item.name ?? '')}</strong>
        <small>{String(item.title ?? '')}</small>
      </div>
      <select
        className="dropdown-select"
        value={String(item.access ?? ROLE_OPTIONS[0])}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          item.access = event.target.value
        }}
      >
        {ROLE_OPTIONS.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * A card with its own detail pane — a SECOND, independent kind of "open"
 * living inside a node. The chart's expand/collapse is about children; this is
 * about the card's own content, and the two must not be mistaken for each
 * other. So the state lives on `item.detail`, never inferred from
 * `context.open`.
 *
 * `onSlide` re-measures the chart: the node's own height follows the
 * disclosure, and sizes are declared rather than measured (layout runs in a
 * worker with no DOM), so the chart has to be told to re-read them.
 */
function renderAccordion(context: NodeContext, onSlide: () => void): ReactNode {
  const item = context.item
  const open = item.detail === true
  const progress = accordionProgress(item)
  return (
    <div className="accordion-card">
      <div className="accordion-head">
        <div className="accordion-text">
          <strong>{String(item.name ?? '')}</strong>
          <small>{String(item.title ?? '')}</small>
        </div>
        <button
          type="button"
          className="accordion-btn"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            item.detail = !open
            onSlide()
          }}
        >
          {open ? 'Hide details' : 'Details'}
        </button>
      </div>
      {/* Driven by the same eased number the node's height is, so the text
          fades in as the room for it appears rather than popping at one end. */}
      <div className={`accordion-body${progress > 0 ? ' is-open' : ''}`} style={{ opacity: progress }}>
        {String(item.department ?? '—')} · {context.directChildren} direct · {context.descendants} total
      </div>
    </div>
  )
}

/** The node as a small toolbar: arbitrary controls on a card, each keeping its
 * own click, with the chart's own toggle as merely one of them. */
function renderActions(context: NodeContext, onRepaint: () => void, onGoto: (id: string) => void): ReactNode {
  const item = context.item
  const starred = item.starred === true
  return (
    <div className="actions-card">
      <div className="actions-text">
        <strong>{String(item.name ?? '')}</strong>
        <small>{String(item.title ?? '')}</small>
      </div>
      <div className="actions-bar">
        <button
          type="button"
          className={`action-btn${starred ? ' is-on' : ''}`}
          title={starred ? 'Starred' : 'Star'}
          onClick={(event) => {
            event.stopPropagation()
            item.starred = !starred
            onRepaint()
          }}
        >
          ★
        </button>
        <button
          type="button"
          className="action-btn"
          title="Go to this node, marking the way"
          onClick={(event) => {
            event.stopPropagation()
            onGoto(context.id)
          }}
        >
          ⇢
        </button>
        {context.hasChildren && (
          <button
            type="button"
            className="action-btn"
            title="Expand or collapse"
            onClick={(event) => {
              event.stopPropagation()
              context.toggle()
            }}
          >
            {context.open ? '−' : '+'}
          </button>
        )}
      </div>
    </div>
  )
}

const RENDERERS: Record<Exclude<Example['content'], 'none'>, (context: NodeContext) => ReactNode> = {
  card: renderCard,
  avatar: renderAvatar,
  monogram: renderMonogram,
  status: renderStatus,
  slot: renderSlot,
  photo: renderPhoto,
  counts: renderCounts,
  bounds: renderBounds,
  dropdown: renderDropdown,
  // These two need to reach back into the demo — see `RENDERERS_WITH` below.
  accordion: renderCard,
  actions: renderCard,
  row: renderRow,
}

/**
 * The two treatments that cannot be a bare `(context) => ReactNode`: they act
 * on the CHART, not just on their own node — an accordion re-measures it, a
 * toolbar flies to a node and marks the route. Bound to the demo's own
 * handlers at render time rather than reaching for a context, because there is
 * exactly one consumer and a provider for two callbacks would be ceremony.
 */
function rendererFor(
  content: Exclude<Example['content'], 'none'>,
  handlers: { onSlide: () => void; onRepaint: () => void; onGoto: (id: string) => void },
): (context: NodeContext) => ReactNode {
  if (content === 'accordion') return (context) => renderAccordion(context, handlers.onSlide)
  if (content === 'actions') {
    return (context) => renderActions(context, handlers.onRepaint, handlers.onGoto)
  }
  return RENDERERS[content]
}

/** Imperative handle main.ts uses to drive the mounted React chart's live controls. */
export interface ReactDemoHandle {
  setMinimap(on: boolean): void
  setMinimapPosition(position: MinimapPosition): void
  setMinimapSilhouette(colour: string): void
  /** One door for every theme token the sidebar owns — see the vanilla demo. */
  setTheme(partial: Partial<Theme>): void
  setRingEnabled(enabled: boolean): void
  /** Live layout tuning — see `KladApi.setLayoutOptions`. */
  setLayoutOptions(settings: LayoutSettings, fit: boolean): void
  setMode(mode: ThemeMode): void
}

export interface ReactDemoProps {
  example: Example
  /** Reports a completed drop for the demo's log — see `dropDetail`. */
  onDrop?: (detail: { ids: string[]; parentId: string | null; mode: string }) => void
  /** Reports the sunburst's new centre, for the breadcrumb. */
  onCentreChange?: (id: string | null) => void
  /** Which shape to draw in. Changing it remounts (see main.ts's `show`) —
   * the content treatment changes with it, and that is a construction-time
   * choice. */
  layout: LayoutName
  mode: ThemeMode
  onReady?: (api: KladApi) => void
  ref?: Ref<ReactDemoHandle>
}

/**
 * The React stack's playground demo — renders the same `EXAMPLES` registry
 * as the vanilla and Vue demos (see data.ts), so the three stacks are
 * directly comparable on identical data and options. Node content branches
 * on `example.content` exactly as `vanilla-demo.ts` and `VueDemo.vue` do;
 * the 'none' example omits the `children` render prop entirely (not a
 * function that returns null) so this adapter never claims overlay DOM it
 * doesn't need — matching the vanilla and Vue "canvas only" behaviour.
 */
export function ReactDemo({
  example,
  layout,
  mode,
  onReady,
  onDrop,
  onCentreChange,
  ref,
}: ReactDemoProps): ReactNode {
  const chartRef = useRef<KladHandle>(null)

  /**
   * Whether the minimap is on, and which corner it's in, for THIS mounted
   * chart. Deliberately `useRef`, not `useState`: they still feed `options`
   * below (so a REMOUNT — e.g. switching example/stack — starts the fresh
   * chart with the current values baked in), but mutating a ref does not trigger a
   * re-render, and reading `.current` inside `useMemo` does not add it as a
   * tracked dependency.
   *
   * If these were state instead — as they were in an earlier version of this
   * file, caught by hand rather than by a type error — then changing either
   * one would re-render with a new `options` object (a new dependency-array
   * entry), which the effect in Klad.tsx (`instance.update(options.data,
   * ...)`, watching `options` by identity) would treat as a prop change and
   * respond to with `instance.update()`, which calls `initOpen()` and resets
   * every node's open/closed state. That is exactly the reset
   * `setMinimap`/`setMinimapPosition` below call the API directly to avoid —
   * so the state that decides what to bake into the next remount has to stay
   * out of React's render cycle entirely. Confirmed with Playwright: collapse
   * a node, click the minimap toggle, watch the collapsed node come back.
   */
  const minimapOnRef = useRef(minimapDefaultOn(example))
  const minimapPositionRef = useRef<MinimapPosition>(minimapDefaultPosition(example))

  /**
   * The light/dark mode this chart MOUNTED in, captured once for the same
   * reason the two refs above exist: it feeds `options`, and `options`
   * changing identity is what makes the adapter call `instance.update()` and
   * reset every node's open/closed state. main.ts flips the mode through
   * `setMode` below instead, which is paint-only.
   */
  const mountedModeRef = useRef<ThemeMode>(mode)

  /** The mode the chart is in NOW — `mountedModeRef` moved on by `setMode` below. */
  const modeRef = useRef<ThemeMode>(mode)

  /** The viewer's own silhouette colour, or `null` while the mode's default applies. */
  const silhouetteRef = useRef<string | null>(null)

  const minimapOption = useCallback((): NonNullable<Options['minimap']> => {
    const base = minimapOptionFor(example, minimapOnRef.current, minimapPositionRef.current, modeRef.current)
    // `typeof base !== 'object'` rather than `=== false`: the option's type
    // allows a bare `true`, which has nowhere to carry a colour.
    if (typeof base !== 'object' || silhouetteRef.current === null) return base
    return { ...base, silhouetteColour: silhouetteRef.current }
  }, [example])

  const options: Options = useMemo<Options>(
    () => ({
      data: example.data,
      nodeSize: DEFAULT_NODE_SIZE,
      label: (item) => String(item.name ?? ''),
      ...optionsForLayout(example, layout),
      theme: themeFor(example, layout, EDGE_RADIUS_DEFAULT, mountedModeRef.current),
      minimap: minimapOptionFor(
        example,
        minimapOnRef.current,
        minimapPositionRef.current,
        mountedModeRef.current,
      ),
    }),
    [example, layout],
  )

  /**
   * The drop log, reported the same way the other two demos do — see
   * `dropDetail`. Not refused: the example is about the chart applying the
   * move.
   */
  const handleNodeDrop = useCallback(
    (event: { ids: string[]; parentId: string | null; mode: string }) => {
      onDrop?.(dropDetail(example.data, event.ids, event.parentId, event.mode))
    },
    [example, onDrop],
  )

  /**
   * Everything an example does that is not a card — the sunburst's drill-down
   * and the drop log — plus the two card handlers that act on the chart.
   * Attached once the chart exists, torn down with it.
   *
   * Shared with the other two stacks (`demo-behaviour.ts`) rather than written
   * here: it is `KladApi` calls in a particular order and nothing about React,
   * and writing it per stack is exactly how half the examples ended up working
   * on only one of them.
   */
  const slide = useMemo(() => createAccordionSlide(() => chartRef.current?.api, example), [example])
  useEffect(() => () => slide.stop(), [slide])

  /**
   * The sunburst's drill-down, delivered through React's own `onNodeClick`
   * prop rather than an imperative subscription — the decision itself is
   * shared with the other two stacks (`createDrill`), only the delivery
   * differs.
   */
  const drill = useMemo(() => createDrill(example, layout), [example, layout])
  const handleNodeClick = useCallback(
    ({ id }: { id: string }) => {
      const api = chartRef.current?.api
      if (!api) return
      const next = drill(id, api.getCentre(), api)
      if (next === undefined) return
      api.setCentre(next)
      onCentreChange?.(api.getCentre())
    },
    [drill, onCentreChange],
  )

  /**
   * The route under the pointer — shared with the other two stacks
   * (`createHoverTrail`), delivered through React's own prop.
   */
  const hoverTrail = useMemo(() => createHoverTrail(() => chartRef.current?.api, example), [example])
  const handleNodeHover = useCallback((event: { id: string | null }) => hoverTrail(event), [hoverTrail])

  const cardHandlers = useMemo(
    () => ({
      onSlide: () => slide.start(),
      // A card changed something about ITSELF — a star toggled — so nothing in
      // the chart's own state moved and it has no reason to draw a frame. A
      // paint-only theme write (a merge of nothing) is how a demo card gets
      // itself redrawn without the library needing a "repaint" verb.
      onRepaint: () => chartRef.current?.api?.setTheme({}),
      onGoto: (id: string) => {
        const api = chartRef.current?.api
        if (api) goTo(api, id)
      },
    }),
    [slide],
  )

  const handleReady = useCallback(() => {
    if (chartRef.current?.api) onReady?.(chartRef.current.api)
  }, [onReady])

  useImperativeHandle(
    ref,
    () => ({
      setMinimap: (on: boolean) => {
        minimapOnRef.current = on
        // Straight through the API rather than via the options-prop update, so
        // toggling the minimap does not reset the tree's expand/collapse state.
        // See the comment on `minimapOnRef` above for why it is a ref, not
        // state, which is what makes this safe rather than merely apparently so.
        chartRef.current?.api?.setMinimap(minimapOption())
      },
      setMinimapPosition: (position: MinimapPosition) => {
        minimapPositionRef.current = position
        chartRef.current?.api?.setMinimap(minimapOption())
      },
      setMinimapSilhouette: (colour: string) => {
        silhouetteRef.current = colour
        chartRef.current?.api?.setMinimap(minimapOption())
      },
      // `KladApi.setTheme` merges a partial over whatever the chart is
      // already showing and repaints — paint-only, so unlike the `key={...}`
      // remount this used to need, camera position and expand/collapse state
      // stay exactly where they were.
      setTheme: (partial: Partial<Theme>) => {
        chartRef.current?.api?.setTheme(partial)
      },
      // `KladApi.setRing` — NOT a theme token, so it goes through its own
      // method rather than `setTheme`; see `Options.ring`'s docblock in
      // packages/core/src/index.ts.
      setRingEnabled: (enabled: boolean) => {
        chartRef.current?.api?.setRing(enabled)
      },
      setLayoutOptions: (settings: LayoutSettings, fit: boolean) => {
        chartRef.current?.api?.setLayoutOptions(settings, { fit })
      },
      // Light/dark, on the same paint-only `setTheme` path as everything
      // above: the canvas's node fill and stroke have to move with the CSS
      // the cards over them use, or the canvas box shows around each card's
      // edges (see theme.ts).
      setMode: (next: ThemeMode) => {
        modeRef.current = next
        chartRef.current?.api?.setTheme(modeThemeFor(example, layout, next))
        // The silhouette is the one piece of the minimap a host stylesheet
        // cannot reach (see `silhouetteColour` in theme.ts), so it is
        // re-applied through the option — only while the widget is showing.
        if (minimapOnRef.current) chartRef.current?.api?.setMinimap(minimapOption())
      },
    }),
    // `layout` is read by `setMode` above and is deliberately not listed:
    // changing it remounts this component (see the prop's own docblock and
    // main.ts's `show`), so it cannot change while this handle is alive and
    // there is no stale closure to capture. Listing it would compile just as
    // well and imply a lifecycle this component does not have.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [example, minimapOption],
  )

  // Content follows the LAYOUT, not the example — see `LAYOUT_PRESETS` in
  // data.ts. The wheel layouts draw their own text on the canvas, so they omit
  // the render prop entirely rather than passing one that returns null: that
  // is what stops this adapter claiming overlay DOM it does not need.
  const content = contentForLayout(example, layout)
  if (content === 'none') {
    return (
      <Klad
        ref={chartRef}
        className="chart-host"
        options={options}
        onReady={handleReady}
        onNodeDrop={handleNodeDrop}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
      />
    )
  }

  const render = rendererFor(content, cardHandlers)
  return (
    <Klad
      ref={chartRef}
      className="chart-host"
      options={options}
      onReady={handleReady}
      onNodeDrop={handleNodeDrop}
      onNodeClick={handleNodeClick}
    >
      {render}
    </Klad>
  )
}
