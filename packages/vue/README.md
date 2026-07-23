# @klad/vue

The Vue 3 adapter for [Klad](https://github.com/n1crack/klad) — an org
chart library that renders 5,000–50,000 nodes at 60fps by laying out and
drawing the tree on a `<canvas>` inside a Web Worker, overlaying real Vue
components only for the nodes currently on screen and zoomed in far enough to
read.

```bash
npm install @klad/vue
```

Peer dependency: `vue >=3.5 <4`.

```vue
<script setup lang="ts">
import { Klad } from '@klad/vue'
import type { Options } from '@klad/vue'

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
  <Klad :options="options" style="width: 100%; height: 100vh">
    <template #node="{ item, hasChildren, open, toggle }">
      <div class="card">
        <strong>{{ String(item.name ?? '') }}</strong>
        <button v-if="hasChildren" type="button" @click="toggle">
          {{ open ? '−' : '+' }}
        </button>
      </div>
    </template>
  </Klad>
</template>
```

Reach the imperative API from a descendant component with `useKlad()`
(`const { api, state } = useKlad()`), or from a template `ref` on
`<Klad>` itself.

Guide, API reference and roadmap:
[the documentation](https://github.com/n1crack/klad).

## Licence

Dual-licensed: [GNU AGPL v3 or later](./LICENSE), or a commercial licence for
use the AGPL does not permit — see [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md),
or email yusuf@ozdemir.be.
