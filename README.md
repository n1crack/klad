# Klad

*κλάδος — Greek for “branch”.*

A framework-agnostic org chart. The tree is laid out and drawn on a `<canvas>`
inside a Web Worker; real framework components are mounted only for the handful
of nodes actually on screen and zoomed in far enough to read.

**The number that matters:** 5,000–50,000 nodes at 60fps. A DOM-per-node chart
cannot get there — 50,000 component instances plus as many connector elements
exhaust memory and layout time long before. Nothing here creates DOM for a node
unless that node is both visible and legible.

📖 **[Documentation](https://klad.ozdemir.be)** — guide, API
reference, and a playground you can dial a chart in with. Run it locally with
`pnpm docs`.

## Packages

| Package | For |
|---|---|
| [`@klad/core`](packages/vanilla) | The frameworkless API. One function, `createKlad`. Use it directly, or read it as the reference for a new binding. |
| [`@klad/vue`](packages/vue) | Vue 3: a `<Klad>` component with a `#node` scoped slot, plus `useKlad()`. |
| [`@klad/react`](packages/react) | React: `<Klad>` with a render prop and a ref handle. |
| [`@klad/engine`](packages/core) | Layout, viewport maths, spatial index, renderer, worker protocol. No DOM. Only needed to build a new binding. |

Each depends on the layers beneath it, so installing one is enough — you never
also install `@klad/core` to use the Vue adapter.

## Install

```bash
npm install @klad/core   # frameworkless
npm install @klad/vue    # Vue 3 (>=3.5 <4)
npm install @klad/react  # React (>=18)
```

## Quick start

```ts
import { createKlad } from '@klad/core'

const chart = createKlad(document.getElementById('chart')!, {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
})

chart.on('nodeClick', ({ id, item }) => console.log('clicked', id, item))
// later: chart.destroy()
```

`data` is flat. Every item is `{ id, parentId?, ...your own fields }`; there is
no nested-children shape, and an item whose `parentId` names nothing becomes a
root with a `warning` event rather than an exception.

The Vue and React versions of this, and everything else, are in the docs.

## `nodeSize` is declared, not measured

```ts
nodeSize: Size | ((item: NodeData) => Size)   // Size = { w: number; h: number }
```

Every DOM-based org chart can mount a node, read its
`getBoundingClientRect()`, and lay out around whatever size it turned out to
be. This one cannot, and that is not an oversight: layout runs inside a Web
Worker, which has no DOM. There is no element to mount, nothing to measure.

That single constraint is what the 50,000-node number is bought with. If your
chart is a hundred nodes and every card is a different height decided by its
own content, a DOM-based chart will serve you better.

When a card genuinely does change height, `api.refresh()` re-reads every node's
size and lays out again while keeping expand/collapse state, camera and
highlight.

## Accessibility

Canvas is invisible to screen readers and keyboard focus, so the chart keeps a
real, hidden DOM tree alongside it: `role="tree"` / `role="treeitem"` rows, one
per node, with `aria-expanded` and `aria-level` in sync. Rows are hidden by
clipping rather than `display: none`, which would also remove them from the
accessibility tree, and use `content-visibility: auto` so a 50,000-node mirror
stays cheap.

| Key | Effect |
|---|---|
| `↑` / `↓` | Previous / next row in document order. |
| `→` | Expands a collapsed node; on an already-expanded one, moves in to the first child. |
| `←` | Collapses an expanded node; on a collapsed one or a leaf, moves out to the parent. |
| `Enter` / `Space` | Toggle the focused row. |
| `Home` / `End` | First / last row. |

Moving focus pans the camera to the focused node, subject to `animate`.

## Browser support

Layout and rendering prefer a Web Worker, via `OffscreenCanvas` and
`transferControlToOffscreen()`. If that fails for any reason — a CSP that
blocks worker scripts, a browser without `OffscreenCanvas`, a canvas whose 2D
context was already claimed — it falls back to the main thread with a
`console.warn` explaining why. Nothing else changes: same options, same events,
same API. `worker: false` forces the fallback yourself.

Needs `Worker`, `OffscreenCanvas`, `ResizeObserver` and Canvas2D — all current
evergreen browsers. Published as ESM only.

## Development

A pnpm workspace (`pnpm@10.13.1`, Node `>=22.12.0`).

```bash
pnpm install
pnpm dev        # the playground: every example, live controls
pnpm docs       # the documentation site
pnpm test       # 442 tests across core/vanilla/vue/react, incl. real-browser mode
pnpm typecheck
pnpm lint
pnpm build
```

`packages/playground` is a Vite app with every example: four orientations, RTL,
variable node sizes, nine card treatments, subtree counts, a go-to-node combo
box, and a 20,000-node stress test.

## Roadmap

1.1 drag-and-drop reparenting · 1.2 cross-links · 1.3 alternative layouts ·
1.4 animated links and custom edges · 1.5 child pagination · 1.6 nested sets.
See [docs/ROADMAP.md](docs/ROADMAP.md).

## License

Dual-licensed, © Yusuf Özdemir.

- **[GNU AGPL v3 or later](LICENSE)** — the default. Free to use, modify and
  distribute on the AGPL's terms, which require the complete source of your
  version to be available to anyone you convey it to, including over a network.
- **[Commercial licence](LICENSE-COMMERCIAL.md)** — for shipping it inside a
  closed-source product or a hosted service without that obligation, or where
  an AGPL dependency is not an option. Email **yusuf@ozdemir.be**.

[LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md) walks through which one applies
to you.
