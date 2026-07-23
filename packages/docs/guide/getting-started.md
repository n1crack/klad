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

## A chart

::: tabs key:stack

== Vanilla

```ts
import { createKlad, type Options } from '@klad/core'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
}

const chart = createKlad(document.getElementById('chart')!, options)

chart.on('nodeClick', ({ id, item }) => console.log('clicked', id, item))

// When the host element goes away:
chart.destroy()
```

== Vue

```vue
<script setup lang="ts">
import { Klad, type Options } from '@klad/vue'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
}
</script>

<template>
  <Klad
    :options="options"
    style="width: 100%; height: 100vh"
    @node-click="({ id }) => console.log('clicked', id)"
  />
</template>
```

== React

```tsx
import { Klad, type Options } from '@klad/react'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
  nodeSize: { w: 180, h: 64 },
  label: (item) => String(item.name ?? ''),
}

export function Chart() {
  return (
    <Klad
      options={options}
      style={{ width: '100%', height: '100vh' }}
      onNodeClick={({ id }) => console.log('clicked', id)}
    />
  )
}
```

:::

The host element needs a size. The chart fills it and follows it with a
`ResizeObserver`; a host that collapses to zero height gets a chart you cannot
see, which is the single most common setup problem.

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

## Next

- [Node content](/guide/node-content) — putting your own components on the nodes.
- [Sizing](/guide/sizing) — why `nodeSize` is declared, and what to do when a card changes height.
- [Navigating](/guide/navigating) — going to a node, opening the way to it, showing the route.
