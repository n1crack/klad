---
title: Events
description: Click, double-click, hover, toggle, selection, drop and viewport events, and how to subscribe to them from JavaScript, Vue or React.
---

# Events

::: tabs key:stack

== Vanilla

```ts
const off = chart.on('nodeClick', ({ id, item }) => {
  console.log(id, item)
})
// later
off()
```

== Vue

```vue
<Klad :options="options" @node-click="onNodeClick" @toggle="onToggle" @warning="onWarning" />
```

== React

```tsx
<Klad options={options} onNodeClick={onNodeClick} onToggle={onToggle} />
```

:::

| Event             | Payload                                      | When                                                                                                                                                       |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`           | —                                            | The first frame has been drawn.                                                                                                                            |
| `nodeClick`       | `{ id, item }`                               | A tap on a node. Not fired for a tap that lands on a card's own button or input.                                                                           |
| `nodeDblClick`    | `{ id, item }`                               | Two taps on the same node inside 300ms. The second does not also emit `nodeClick`.                                                                         |
| `nodeHover`       | `{ id, item }` or `{ id: null, item: null }` | Enter and leave. Not re-fired for repeated moves within the same node.                                                                                     |
| `toggle`          | `{ id, open }`                               | A node was expanded or collapsed, however it happened.                                                                                                     |
| `selectionChange` | `{ ids, items }`                             | The selection changed. Carries the whole selection, not a delta.                                                                                           |
| `nodeDrop`        | `NodeDropEvent`                              | A node was dropped somewhere new. Fires BEFORE anything moves.                                                                                             |
| `addRequested`    | `{ afterId, parentId, index }`               | The viewer pressed `Shift+Enter` on a node and wants a sibling after it. A request, not an action — see [Without a pointer](/api/chart#without-a-pointer). |
| `viewChange`      | `ChartView`                                  | Camera, open branches, selection, highlight, isolation, filter or lifted caps changed. The whole view, exactly what `getView()` returns.                   |
| `filterChange`    | `{ query, matched }`                         | The filter changed. `matched` is what `filter()` returns; `query` is `null` for none and for a predicate, which cannot be written down.                    |
| `layoutChange`    | `{ settings }`                               | The layout or one of its knobs changed. Carries the settings as they now stand, not the delta — so a sidebar mirroring the chart reads what IS.            |
| `childrenLoaded`  | `{ id, item, items }`                        | `loadChildren` returned and the chart took the children in. Informational — it holds them either way.                                                      |
| `viewportChange`  | `{ camera }`                                 | Any camera change — pan, zoom, ease, kinetic coast. Fires per frame while one is running.                                                                  |
| `warning`         | `Warning`                                    | Something in the data could not be honoured.                                                                                                               |

## Refusing a move

`nodeDrop` is the one event that fires _before_ the thing it describes. That
is what makes it refusable:

```ts
chart.on('nodeDrop', ({ ids, parentId, index, mode, preventDefault }) => {
  if (parentId === null) return preventDefault() // no new roots
  save(ids, parentId, index)
})
```

| Field              |                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------- |
| `ids`              | What is moving, in tree order — the whole selection if a selected node was dragged |
| `items`            | The same nodes' data objects                                                       |
| `parentId`         | The new parent, or `null` for a drop that makes a root                             |
| `index`            | Position among the new parent's children                                           |
| `mode`             | `'into'`, `'before'` or `'after'`                                                  |
| `preventDefault()` | Refuse the move; the chart applies nothing                                         |

Without a `preventDefault()`, the chart applies the move as soon as the
handler returns and animates the result — so an `async` handler must call it
first, before its first `await`. `NodeDropEvent` is exported from every
package. See [Drag and drop](/guide/drag-and-drop).

## Warnings are not errors

Bad data draws. A `parentId` naming nothing, a duplicate `id`, a cycle — each
one is resolved in a defined way and reported rather than thrown:

```ts
chart.on('warning', ({ code, detail, ids }) => {
  console.warn(code, detail, ids)
})
```

| `code`          |                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `duplicate-id`  | Two rows share an `id`. The later one is dropped.                                                           |
| `orphan-parent` | A `parentId` names nothing. The node becomes a root.                                                        |
| `cycle`         | A node is its own ancestor. The link that closes the loop is cut.                                           |
| `load-failed`   | A [`loadChildren`](/guide/children-on-demand) rejected. The node stays unloaded and the next click retries. |

A tree is usually built from data somebody else owns, and refusing to render
because one row of ten thousand points at a deleted manager is not useful
behaviour. The chart shows you the other 9,999 and tells you about the one.
`load-failed` is the odd one out — nothing is wrong with your data, a request
did not come back — but it reaches you the same way for the same reason.

Warnings from the initial load are emitted after construction returns, so a
listener attached on the next line still hears them.
