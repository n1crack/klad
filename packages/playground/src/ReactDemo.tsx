/** @jsxImportSource react */
import { useCallback, useImperativeHandle, useMemo, useRef, type CSSProperties, type ReactNode, type Ref } from 'react'
import { Klados, type NodeContext, type KladosApi, type KladosHandle, type Options } from '@klados/react'
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
  type Department,
  type Example,
  type MinimapPosition,
} from './data.js'
import type { ThemeMode } from './theme.js'

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
  return (
    <div className="card">
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

const RENDERERS: Record<Exclude<Example['content'], 'none'>, (context: NodeContext) => ReactNode> = {
  card: renderCard,
  avatar: renderAvatar,
  monogram: renderMonogram,
  status: renderStatus,
  photo: renderPhoto,
  // The four card treatments added for the 1.0 feature work — subtree counts,
  // a dropdown, an accordion, a button toolbar — are demonstrated in the
  // vanilla demo, which is the reference implementation every adapter is
  // written against. They fall back to the plain card here, exactly as they do
  // in the Vue demo's `v-else` branch: the point they make is about the node
  // context and the overlay, both of which are adapter-independent, so
  // restating each of them three times would add maintenance without adding
  // anything a reader learns from.
  counts: renderCard,
  dropdown: renderCard,
  accordion: renderCard,
  actions: renderCard,
}

/** Imperative handle main.ts uses to drive the mounted React chart's live controls. */
export interface ReactDemoHandle {
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

export interface ReactDemoProps {
  example: Example
  mode: ThemeMode
  onReady?: (api: KladosApi) => void
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
export function ReactDemo({ example, mode, onReady, ref }: ReactDemoProps): ReactNode {
  const chartRef = useRef<KladosHandle>(null)

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
   * entry), which the effect in Klados.tsx (`instance.update(options.data,
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

  const options: Options = useMemo<Options>(
    () => ({
      data: example.data,
      nodeSize: DEFAULT_NODE_SIZE,
      label: (item) => String(item.name ?? ''),
      ...example.options,
      theme: themeFor(example, EDGE_RADIUS_DEFAULT, mountedModeRef.current),
      minimap: minimapOptionFor(example, minimapOnRef.current, minimapPositionRef.current, mountedModeRef.current),
    }),
    [example],
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
        chartRef.current?.api?.setMinimap(
          minimapOptionFor(example, on, minimapPositionRef.current, modeRef.current),
        )
      },
      setMinimapPosition: (position: MinimapPosition) => {
        minimapPositionRef.current = position
        chartRef.current?.api?.setMinimap(
          minimapOptionFor(example, minimapOnRef.current, position, modeRef.current),
        )
      },
      // `edgeCornerRadius`/`nodeFill` both live under `theme`, which used to
      // require a full `key={...}` remount to change post-construction
      // (theme was resolved exactly once, at `createKlados`, and
      // `instance.update()` never re-resolved it). `KladosApi.setTheme`
      // (packages/vanilla/src/index.ts) fixes that: it merges a partial
      // theme over whatever the chart is already showing, re-resolves it,
      // and repaints — paint-only, so this no longer resets camera position
      // or expand/collapse state the way the remount used to on every drag
      // tick.
      setEdgeRadius: (radius: number) => {
        chartRef.current?.api?.setTheme({ edgeCornerRadius: radius })
      },
      setNodeFill: (nodeFill: string) => {
        chartRef.current?.api?.setTheme({ nodeFill })
      },
      setBlockFill: (blockFill: string) => {
        chartRef.current?.api?.setTheme({ blockFill })
      },
      // One accent for the ring, a highlighted node's outline and a
      // highlighted path's connectors — see the vanilla demo's `setAccent`.
      setAccent: (accent: string) => {
        chartRef.current?.api?.setTheme({
          ringStroke: accent,
          edgeHighlightStroke: accent,
          highlightStroke: accent,
        })
      },
      setEdgeWidth: (width: number) => {
        chartRef.current?.api?.setTheme({
          edgeWidth: width,
          edgeHighlightWidth: highlightWidthFor(width),
        })
      },
      // `KladosApi.setRing` — NOT a theme token, so it goes through its own
      // method rather than `setTheme`; see `Options.ring`'s docblock in
      // packages/vanilla/src/index.ts.
      setRingEnabled: (enabled: boolean) => {
        chartRef.current?.api?.setRing(enabled)
      },
      // Light/dark, on the same paint-only `setTheme` path as everything
      // above: the canvas's node fill and stroke have to move with the CSS
      // the cards over them use, or the canvas box shows around each card's
      // edges (see theme.ts).
      setMode: (next: ThemeMode) => {
        modeRef.current = next
        chartRef.current?.api?.setTheme(modeThemeFor(example, next))
        // The silhouette is the one piece of the minimap a host stylesheet
        // cannot reach (see `silhouetteColour` in theme.ts), so it is
        // re-applied through the option — only while the widget is showing.
        if (minimapOnRef.current) {
          chartRef.current?.api?.setMinimap(
            minimapOptionFor(example, true, minimapPositionRef.current, next),
          )
        }
      },
    }),
    [example],
  )

  if (example.content === 'none') {
    return <Klados ref={chartRef} className="chart-host" options={options} onReady={handleReady} />
  }

  const render = RENDERERS[example.content]
  return (
    <Klados ref={chartRef} className="chart-host" options={options} onReady={handleReady}>
      {render}
    </Klados>
  )
}
