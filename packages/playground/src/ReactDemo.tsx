/** @jsxImportSource react */
import { useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { OrgChart, type NodeContext, type OrgChartApi, type OrgChartHandle, type Options } from '@n1crack/orgchart-react'
import { DEPARTMENT_COLOR, initials, type Department, type Example } from './data.js'

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

function renderChip(context: NodeContext): ReactNode {
  return (
    <div className="chip">
      <span>{String(context.item.name ?? '')}</span>
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
  chip: renderChip,
  status: renderStatus,
  photo: renderPhoto,
}

export interface ReactDemoProps {
  example: Example
  onReady?: (api: OrgChartApi) => void
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
export function ReactDemo({ example, onReady }: ReactDemoProps): ReactNode {
  const chartRef = useRef<OrgChartHandle>(null)

  const options: Options = useMemo<Options>(
    () => ({
      data: example.data,
      nodeSize: DEFAULT_NODE_SIZE,
      label: (item) => String(item.name ?? ''),
      ...example.options,
    }),
    [example],
  )

  const handleReady = useCallback(() => {
    if (chartRef.current?.api) onReady?.(chartRef.current.api)
  }, [onReady])

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
