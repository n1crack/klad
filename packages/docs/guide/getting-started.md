# Getting started

## Install

Install the binding you want. Each one depends on the layers beneath it, so
there is never a second package to remember.

::: tabs key:stack

== Vanilla

```bash
npm install @klad/core
```

== Vue

```bash
npm install @klad/vue
```

Vue 3.5 or newer, as a peer dependency.

== React

```bash
npm install @klad/react
```

React 18 or newer, as a peer dependency.

:::

There is a fourth package, `@klad/engine`, but you only install it
directly to write a binding for a framework that does not have one. It is the
pure-logic layer — layout, viewport maths, the quadtree, the renderer, the
worker protocol — and it touches no DOM.

## The smallest chart

`data` is the only option without a default. Give it a flat array and you have
a working chart: nodes are sized `180x64`, labelled from each item's `name`
(or `label`, or `title`, or failing those its `id`), laid out top-to-bottom,
pannable, zoomable and keyboard-navigable.

::: tabs key:stack

== Vanilla

```ts
import { createKlad } from '@klad/core'

const chart = createKlad(document.getElementById('chart')!, {
  data: [
    { id: 'ceo', name: 'Jamie Fox' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao' },
  ],
})
```

== Vue

```vue
<script setup lang="ts">
import { Klad } from '@klad/vue'

const data = [
  { id: 'ceo', name: 'Jamie Fox' },
  { id: 'cto', parentId: 'ceo', name: 'Amy Chen' },
  { id: 'cfo', parentId: 'ceo', name: 'Priya Rao' },
]
</script>

<template>
  <Klad :options="{ data }" style="width: 100%; height: 100vh" />
</template>
```

== React

```tsx
import { Klad } from '@klad/react'

const data = [
  { id: 'ceo', name: 'Jamie Fox' },
  { id: 'cto', parentId: 'ceo', name: 'Amy Chen' },
  { id: 'cfo', parentId: 'ceo', name: 'Priya Rao' },
]

export function Chart() {
  return <Klad options={{ data }} style={{ width: '100%', height: '100vh' }} />
}
```

:::

::: warning The host element needs a height
The chart fills its host and follows it with a `ResizeObserver`. A host that
collapses to zero height gives you a chart you cannot see — the single most
common setup problem, and it looks exactly like "nothing rendered".
:::

## Shaping the data

`data` is a flat array. Parentage is `parentId` and nothing else — there is no
nested `children` shape to convert to, which means the array that came back
from your API is very often already the right shape.

```ts
[
  { id: 'ceo' }, //                      no parentId -> a root
  { id: 'cto', parentId: 'ceo' },
  { id: 'lead', parentId: 'cto' },
]
```

Everything beyond `id` and `parentId` is yours: `name`, `title`, `avatarUrl`,
whatever your card renders and your `label` reads.

Several roots are fine — the layout places them side by side. A `parentId`
naming an item that is not in the array does not throw; that item becomes a
root and a `warning` event describes what happened, so a chart built from
partial data still draws.

## Then add what you need

Each of these is one option or one call, and none of them is a prerequisite
for the others. Take them in whatever order your chart asks for.

| You want | Add |
|---|---|
| Your own card instead of a drawn label | `renderNode`, a `#node` slot, or a render prop — see [Node content](/guide/node-content) |
| Bigger or per-node boxes | `nodeSize` — see [Sizing](/guide/sizing) |
| A different growth direction | `orientation: 'lr'`, plus `rtl` if you need mirrored siblings |
| To start collapsed | `collapsedByDefault: true` |
| A map of where you are | `minimap: true` |
| To react to clicks | `chart.on('nodeClick', …)` / `@node-click` / `onNodeClick` — see [Events](/api/events) |
| To move the camera | `chart.api.focus(id)`, `fit()`, `zoomTo(k)` — see [Navigating](/guide/navigating) |
| Different colours | `theme`, live via `setTheme` — see [Theme](/api/theme) |

## A fuller example

The same chart with the options most charts end up wanting: real cards, a
minimap, and a click handler.

::: tabs key:stack

== Vanilla

```ts
import { createKlad } from '@klad/core'

const chart = createKlad(document.getElementById('chart')!, {
  data,
  nodeSize: { w: 220, h: 88 },
  minimap: true,
  renderNode: (element, { item }) => {
    element.innerHTML = `<div class="card">
      <strong>${item.name}</strong><small>${item.title ?? ''}</small>
    </div>`
  },
})

chart.on('nodeClick', ({ id, item }) => console.log('clicked', id, item))

// When the host element goes away:
chart.destroy()
```

== Vue

```vue
<script setup lang="ts">
import { Klad, type Options } from '@klad/vue'

const options: Options = { data, nodeSize: { w: 220, h: 88 }, minimap: true }
</script>

<template>
  <Klad
    :options="options"
    style="width: 100%; height: 100vh"
    @node-click="({ id }) => console.log('clicked', id)"
  >
    <template #node="{ item }">
      <div class="card">
        <strong>{{ item.name }}</strong>
        <small>{{ item.title }}</small>
      </div>
    </template>
  </Klad>
</template>
```

== React

```tsx
import { Klad, type Options } from '@klad/react'

const options: Options = { data, nodeSize: { w: 220, h: 88 }, minimap: true }

export function Chart() {
  return (
    <Klad
      options={options}
      style={{ width: '100%', height: '100vh' }}
      onNodeClick={({ id }) => console.log('clicked', id)}
    >
      {({ item }) => (
        <div className="card">
          <strong>{item.name}</strong>
          <small>{item.title}</small>
        </div>
      )}
    </Klad>
  )
}
```

:::

## Next

- [Node content](/guide/node-content) — putting your own components on the nodes.
- [Sizing](/guide/sizing) — why `nodeSize` is declared, and what to do when a card changes height.
- [Navigating](/guide/navigating) — going to a node, opening the way to it, showing the route.
