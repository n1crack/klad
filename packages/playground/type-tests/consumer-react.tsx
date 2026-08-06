/**
 * What someone who installs `@klad/react` writes — checked against the `.d.ts`
 * this repository publishes rather than against its own source. See
 * `consumer.vue` for why that distinction matters and `tsconfig.consumer.json`
 * for how the import is redirected.
 *
 * `@klad/react` has not shipped the bug its Vue sibling did: its declarations
 * are built from named interfaces written by hand, so nothing about its public
 * surface is inferred and there is nothing for inference to leak. That is
 * exactly why it is worth pinning — the current shape is the one worth keeping,
 * and nothing else in this repository looks at it.
 */
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Klad, useKlad } from '@klad/react'
import type {
  KladApi,
  KladHandle,
  KladProps,
  NodeContext,
  NodeData,
  NodeDropEvent,
  NodePlace,
  Options,
  Size,
  Warning,
} from '@klad/react'

/** Fails to compile unless the argument's inferred type is assignable to `T`. */
function expectType<T>(value: T): void {
  void value
}

/**
 * The declarations that were impossible before this package re-exported
 * core's types: an inline literal in `data` infers, but naming the array's
 * element type, or the argument `nodeSize` returns, or the payload a warning
 * handler receives, all required importing `@klad/core` directly.
 */
const people: NodeData[] = [
  { id: 'root', name: 'Root' },
  { id: 'child', parentId: 'root' },
]

const nodeSize = (item: NodeData, at: NodePlace): Size =>
  at.depth === 0 ? { w: 200, h: 72 } : { w: 160, h: 56 }

function report(warning: Warning): void {
  void warning
}

const options: Options = { data: people, nodeSize }

// --- props -----------------------------------------------------------------

expectType<Options>({} as KladProps['options'])
expectType<string | undefined>({} as KladProps['className'])

// --- events ----------------------------------------------------------------
// A missing handler fails here as an unknown key; a changed payload fails on
// the assertions inside.

const onNodeClick: NonNullable<KladProps['onNodeClick']> = (event) => {
  expectType<string>(event.id)
  expectType<string>(event.item.id)
}

const onNodeHover: NonNullable<KladProps['onNodeHover']> = (event) => {
  expectType<string | null>(event.id)
}

const onNodeDrop: NonNullable<KladProps['onNodeDrop']> = (event) => {
  expectType<NodeDropEvent>(event)
  // The veto travels on the payload rather than as a return value, the same
  // way it does in the vanilla layer and the Vue adapter.
  event.preventDefault()
}

const onChildrenLoaded: NonNullable<KladProps['onChildrenLoaded']> = (event) => {
  expectType<string>(event.items[0]?.id ?? '')
}

const onToggle: NonNullable<KladProps['onToggle']> = (event) => {
  expectType<boolean>(event.open)
}

const onNodeDblClick: NonNullable<KladProps['onNodeDblClick']> = (event) => void event.id
const onWarning: NonNullable<KladProps['onWarning']> = (warning) => report(warning)
/** Carries nothing — this fails to compile if it ever grows a parameter. */
const onReady: NonNullable<KladProps['onReady']> = () => {}

// --- the ref handle --------------------------------------------------------

export function Consumer(): ReactNode {
  const chart = useRef<KladHandle>(null)

  function readApi(): KladApi | null {
    return chart.current?.api ?? null
  }
  void readApi

  return (
    <Klad
      ref={chart}
      options={options}
      className="chart"
      style={{ height: '100%' }}
      onNodeClick={onNodeClick}
      onNodeHover={onNodeHover}
      onNodeDblClick={onNodeDblClick}
      onNodeDrop={onNodeDrop}
      onChildrenLoaded={onChildrenLoaded}
      onToggle={onToggle}
      onWarning={onWarning}
      onReady={onReady}
    >
      {/* The render prop, destructured the way a card does. */}
      {(context: NodeContext) => (
        <article>
          {context.item.id} / {context.descendants}
        </article>
      )}
    </Klad>
  )
}

// --- the hook --------------------------------------------------------------

export function Card(): ReactNode {
  const { api, state } = useKlad()
  expectType<KladApi | null>(api)
  return <span>{state?.nodeCount ?? 0}</span>
}
