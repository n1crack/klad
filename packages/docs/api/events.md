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
<OrgChart
  :options="options"
  @node-click="onNodeClick"
  @toggle="onToggle"
  @warning="onWarning"
/>
```

== React

```tsx
<OrgChart options={options} onNodeClick={onNodeClick} onToggle={onToggle} />
```

:::

| Event | Payload | When |
|---|---|---|
| `ready` | — | The first frame has been drawn. |
| `nodeClick` | `{ id, item }` | A tap on a node. Not fired for a tap that lands on a card's own button or input. |
| `nodeDblClick` | `{ id, item }` | Two taps on the same node inside 300ms. The second does not also emit `nodeClick`. |
| `nodeHover` | `{ id, item }` or `{ id: null, item: null }` | Enter and leave. Not re-fired for repeated moves within the same node. |
| `toggle` | `{ id, open }` | A node was expanded or collapsed, however it happened. |
| `viewportChange` | `{ camera }` | Any camera change — pan, zoom, ease, kinetic coast. Fires per frame while one is running. |
| `warning` | `Warning` | Something in the data could not be honoured. |

## Warnings are not errors

Bad data draws. A `parentId` naming nothing, a duplicate `id`, a cycle — each
one is resolved in a defined way and reported rather than thrown:

```ts
chart.on('warning', (warning) => {
  console.warn(warning.code, warning.message, warning.id)
})
```

An org chart is usually built from data somebody else owns, and refusing to
render because one row of ten thousand points at a deleted manager is not
useful behaviour. The chart shows you the other 9,999 and tells you about the
one.

Warnings from the initial load are emitted after construction returns, so a
listener attached on the next line still hears them.
