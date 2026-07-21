# @n1crack/orgchart-vue

The Vue 3 adapter for [OrgChart](https://github.com/n1crack/orgchart) — an org
chart library that renders 5,000–50,000 nodes at 60fps by laying out and
drawing the tree on a `<canvas>` inside a Web Worker, overlaying real Vue
components only for the nodes currently on screen and zoomed in far enough to
read.

```bash
npm install @n1crack/orgchart-vue
```

Peer dependency: `vue >=3.5 <4`.

```vue
<script setup lang="ts">
import { OrgChart } from '@n1crack/orgchart-vue'
import type { Options } from '@n1crack/orgchart-vue'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
  ],
  nodeSize: { w: 180, h: 64 }, // required — layout runs in a worker with no DOM to measure
  label: (item) => String(item.name ?? ''),
}
</script>

<template>
  <OrgChart :options="options" style="width: 100%; height: 100vh">
    <template #node="{ item, hasChildren, open, toggle }">
      <div class="card">
        <strong>{{ String(item.name ?? '') }}</strong>
        <button v-if="hasChildren" type="button" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>
    </template>
  </OrgChart>
</template>
```

Reach the imperative API from a descendant component with `useOrgChart()`
(`const { api, state } = useOrgChart()`), or from a template `ref` on
`<OrgChart>` itself.

Full options/API reference, events, and accessibility notes live in the
[repository README](https://github.com/n1crack/orgchart#readme).
