import {
  createOrgChart,
  type ChartState,
  type NodeContext,
  type Options,
  type OrgChartApi,
  type OrgChartEvents,
  type OrgChartInstance,
} from '@n1crack/orgchart'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { OrgChartContext } from './useOrgChart.js'

export interface OrgChartHandle {
  api: OrgChartApi | null
}

export interface OrgChartProps {
  options: Options
  /**
   * Render prop for node content — React's equivalent of the vanilla layer's
   * `renderNode(el, ctx)` callback and the Vue adapter's `#node` scoped slot.
   * Attached to the chart's `renderNode` option only when defined (see
   * `withRenderNode` below): a React consumer who wants the plain canvas
   * chart pays nothing for overlay DOM, exactly like the vanilla and Vue
   * paths.
   */
  children?: (context: NodeContext) => ReactNode
  className?: string
  style?: CSSProperties
  ref?: Ref<OrgChartHandle>
  onNodeClick?: OrgChartEvents['nodeClick']
  onNodeHover?: OrgChartEvents['nodeHover']
  onNodeDblClick?: OrgChartEvents['nodeDblClick']
  onToggle?: OrgChartEvents['toggle']
  onWarning?: OrgChartEvents['warning']
  onReady?: OrgChartEvents['ready']
}

/**
 * One pooled overlay `<div>` from packages/vanilla/src/overlay.ts, and the
 * latest node context the vanilla layer handed it. `key` is assigned once,
 * the first time this particular element is seen, and never changes for the
 * element's lifetime. That is what keeps the portal below stable across
 * frames: the vanilla layer reuses the same `HTMLElement` per pooled slot
 * rather than recreating DOM as panning reassigns which chart node a slot
 * shows (see the overlay module for why), and keying the portal to the
 * element rather than to the node it currently displays is what lets React
 * patch the existing subtree instead of unmounting and remounting it every
 * frame the camera moves.
 */
interface Slot {
  key: number
  element: HTMLElement
  context: NodeContext
}

/**
 * The wrapper fills the overlay slot it is rendered into. The slot element
 * already carries an inline width/height matching the declared nodeSize, but
 * this div sits between them, so without stretching it a percentage height
 * on the consumer's card has nothing to resolve against and the card
 * collapses to its content — leaving the canvas-drawn box visible
 * underneath. Vanilla has no such wrapper, so omitting this would make this
 * adapter disagree with vanilla and Vue. Mirrors OrgChart.vue's
 * `WRAPPER_STYLE` exactly.
 */
const WRAPPER_STYLE: CSSProperties = { display: 'block', boxSizing: 'border-box', width: '100%', height: '100%' }

/**
 * Binds React to `@n1crack/orgchart`. Every chart behaviour — layout, canvas
 * drawing, hit-testing, pointer/keyboard input, the worker — lives in the
 * vanilla layer; this component only creates it, keeps it in sync with
 * props, and renders node content through portals into the overlay elements
 * the vanilla layer hands back.
 */
export function OrgChart(props: OrgChartProps): ReactNode {
  const { options, children, className, style, ref } = props

  const hostRef = useRef<HTMLDivElement | null>(null)
  const [instance, setInstance] = useState<OrgChartInstance | null>(null)
  const [api, setApi] = useState<OrgChartApi | null>(null)

  // Read by the stable `renderNode` callback below, so a new render-prop
  // function identity (an inline arrow function is a new identity on every
  // render, same as any React render prop) never has to recreate the chart —
  // only a genuine option change goes through `chart.update()`.
  const childrenRef = useRef(children)
  childrenRef.current = children
  const hasChildren = children !== undefined

  // Latest event handlers, read from inside the `chart.on(...)` subscriptions
  // set up once at creation — same reasoning as `childrenRef`.
  const handlersRef = useRef({
    onNodeClick: props.onNodeClick,
    onNodeHover: props.onNodeHover,
    onNodeDblClick: props.onNodeDblClick,
    onToggle: props.onToggle,
    onWarning: props.onWarning,
    onReady: props.onReady,
  })
  handlersRef.current = {
    onNodeClick: props.onNodeClick,
    onNodeHover: props.onNodeHover,
    onNodeDblClick: props.onNodeDblClick,
    onToggle: props.onToggle,
    onWarning: props.onWarning,
    onReady: props.onReady,
  }

  // --- overlay bookkeeping ---
  // One `Slot` per pooled element, never one per chart node. `renderNode`
  // fires from inside the vanilla layer's rAF loop, outside React's render
  // cycle entirely, so it can only stash the latest context on the existing
  // slot (or create one the first time this element is seen) and ask React
  // to re-render — it must never mint a fresh key for an element it has
  // already seen, or the portal keyed to that element would unmount and
  // remount every frame the camera moves, which is exactly the churn the
  // pool exists to avoid (see the identity test in
  // orgchart.browser.test.tsx).
  const slotsRef = useRef(new Map<HTMLElement, Slot>())
  const nextKeyRef = useRef(0)
  const [, forceRender] = useReducer((n: number) => n + 1, 0)

  const renderNode = useCallback((element: HTMLElement, context: NodeContext): void => {
    if (childrenRef.current === undefined) return
    const existing = slotsRef.current.get(element)
    if (existing === undefined) {
      slotsRef.current.set(element, { key: nextKeyRef.current++, element, context })
    } else {
      existing.context = context
    }
    forceRender()
  }, [])

  /**
   * Options with `renderNode` attached only when there is content to render.
   * Passing it unconditionally would make the vanilla layer allocate and
   * position an overlay element per visible node for a callback that does
   * nothing — so a React consumer wanting the plain canvas chart would pay
   * for DOM a frameworkless consumer does not. Same tier either way.
   */
  const withRenderNode = useCallback(
    (base: Options): Options => (hasChildren ? { ...base, renderNode } : { ...base }),
    [hasChildren, renderNode],
  )

  // Whether the next `chart.update()` request (see the effect below) should
  // be skipped. It should be, exactly once, right after the chart is
  // created: that commit's `options`/`hasChildren` are exactly what the
  // chart was just constructed with, and `update()` additionally resets
  // every node's open/closed state via the vanilla layer's `initOpen()`,
  // which would silently undo real expand/collapse state if it ever ran
  // redundantly.
  const skipNextUpdateRef = useRef(true)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null) return

    skipNextUpdateRef.current = true
    const chart = createOrgChart(host, withRenderNode(options))
    setInstance(chart)
    setApi(chart.api)

    const unsubscribers = [
      chart.on('nodeClick', (event) => handlersRef.current.onNodeClick?.(event)),
      chart.on('nodeHover', (event) => handlersRef.current.onNodeHover?.(event)),
      chart.on('nodeDblClick', (event) => handlersRef.current.onNodeDblClick?.(event)),
      chart.on('toggle', (event) => handlersRef.current.onToggle?.(event)),
      chart.on('warning', (warning) => handlersRef.current.onWarning?.(warning)),
      chart.on('ready', () => handlersRef.current.onReady?.()),
    ]

    return () => {
      for (const off of unsubscribers) off()
      chart.destroy()
      setInstance(null)
      setApi(null)
      // Dropping every slot — rather than leaving stale elements keyed to a
      // destroyed chart — is what lets the portals below unmount cleanly on
      // this same commit instead of leaking mounted trees under DOM that
      // `chart.destroy()` already detached.
      slotsRef.current.clear()
    }
    // Mount once: `options`/`hasChildren` changes are handled by the effect
    // below via `chart.update()`, never by recreating the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (instance === null) return
    if (skipNextUpdateRef.current) {
      skipNextUpdateRef.current = false
      return
    }
    instance.update(options.data, withRenderNode(options))
  }, [instance, options, withRenderNode])

  // `useSyncExternalStore`, not `useState` updated from an effect:
  // `subscribe` is an external store the vanilla layer owns, and this is the
  // hook React provides with correct tearing behaviour under concurrent
  // rendering for exactly that shape. `cachedStateRef` holds the precise
  // object `subscribe`'s listener last received; `getSnapshot` returns that
  // same cached reference between notifications rather than recomputing one,
  // because a getSnapshot that returns a new object identity on every call
  // reads to React as a store that is changing on every render.
  const cachedStateRef = useRef<ChartState | null>(null)
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      if (instance === null) return () => {}
      return instance.subscribe((next) => {
        cachedStateRef.current = next
        onStoreChange()
      })
    },
    [instance],
  )
  const getSnapshot = useCallback((): ChartState | null => cachedStateRef.current, [])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useImperativeHandle(ref, () => ({ api }), [api])

  const slots = Array.from(slotsRef.current.values())
  // Fixed "orgchart" marker class plus whatever the consumer passed, mirroring
  // OrgChart.vue's template (`class="orgchart"` on its root, with Vue's
  // automatic fallthrough merging in the caller's own `class`).
  const hostClassName = className === undefined ? 'orgchart' : `orgchart ${className}`

  return (
    <OrgChartContext.Provider value={{ api, state }}>
      <div ref={hostRef} className={hostClassName} style={style} />
      {hasChildren
        ? slots.map((slot) =>
            createPortal(
              <div className="orgchart-node" style={WRAPPER_STYLE}>
                {children(slot.context)}
              </div>,
              slot.element,
              String(slot.key),
            ),
          )
        : null}
    </OrgChartContext.Provider>
  )
}
