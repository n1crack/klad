/** @jsxImportSource react */
import { useCallback, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { OrgChart, type NodeContext, type OrgChartApi, type OrgChartHandle, type Options } from '@n1crack/orgchart-react'
import { DEPARTMENT_COLOR, initials, minimapDefaultOn, minimapOptionFor, type Department, type Example } from './data.js'

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
}

/** Imperative handle main.ts uses to flip the minimap for the mounted React chart. */
export interface ReactDemoHandle {
  setMinimap(on: boolean): void
}

export interface ReactDemoProps {
  example: Example
  onReady?: (api: OrgChartApi) => void
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
export function ReactDemo({ example, onReady, ref }: ReactDemoProps): ReactNode {
  const chartRef = useRef<OrgChartHandle>(null)

  // Whether the minimap is currently on for THIS mounted chart. Starts at the
  // example's own declared default; the playground toolbar's minimap toggle
  // flips it via the imperative `setMinimap` handle below, which only sets
  // this piece of state — `options` below picks up the new value on the next
  // render, and `OrgChart`'s own effect (see OrgChart.tsx: `instance.update(...)`
  // whenever `options` changes) does the rest. No core change, no remount.
  const [minimapOn, setMinimapOn] = useState(() => minimapDefaultOn(example))

  const options: Options = useMemo<Options>(
    () => ({
      data: example.data,
      nodeSize: DEFAULT_NODE_SIZE,
      label: (item) => String(item.name ?? ''),
      ...example.options,
      minimap: minimapOptionFor(example, minimapOn),
    }),
    [example, minimapOn],
  )

  const handleReady = useCallback(() => {
    if (chartRef.current?.api) onReady?.(chartRef.current.api)
  }, [onReady])

  useImperativeHandle(
    ref,
    () => ({
      setMinimap: (on: boolean) => {
        setMinimapOn(on)
        // Straight through the API rather than via the options-prop update, so
        // toggling the minimap does not reset the tree's expand/collapse state.
        chartRef.current?.api?.setMinimap(minimapOptionFor(example, on))
      },
    }),
    [example],
  )

  if (example.content === 'none') {
    return <OrgChart ref={chartRef} className="chart-host" options={options} onReady={handleReady} />
  }

  const render = RENDERERS[example.content]
  return (
    <OrgChart ref={chartRef} className="chart-host" options={options} onReady={handleReady}>
      {render}
    </OrgChart>
  )
}
