# klad

[![npm](https://img.shields.io/npm/v/@klad/core?color=cb3837&logo=npm&logoColor=white&label=npm)](https://www.npmjs.com/package/@klad/core)
[![gzip size](https://img.shields.io/bundlejs/size/@klad/core?label=gzip)](https://bundlejs.com/?q=%40klad%2Fcore)
[![licence](https://img.shields.io/npm/l/@klad/core?label=licence)](https://github.com/n1crack/klad/blob/main/LICENSE)

The frameworkless API for [Klad](https://github.com/n1crack/klad) — a tree
engine that stays smooth where a chart made of elements cannot, by laying
out and drawing the tree on a `<canvas>` inside a Web Worker, overlaying real DOM only for the
nodes currently on screen and zoomed in far enough to read.

One flat array of `{ id, parentId }` in; whichever shape reads best out —
tiered, indented rows, radial rings, or a wheel you can drill into.

This package is one function.

```bash
npm install @klad/core
```

```ts
import { createKlad, type Options } from '@klad/core'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
  ],
  renderNode(element, context) {
    element.innerHTML = `<strong>${String(context.item.name ?? '')}</strong>`
  },
}

const chart = createKlad(document.getElementById('chart')!, options)
chart.on('nodeClick', ({ id, item }) => console.log(id, item))
// chart.destroy() when done
```

Using Vue? Use [`@klad/vue`](https://www.npmjs.com/package/@klad/vue)
instead — it's built on this package and adds a `#node` scoped slot.

Guide, API reference and roadmap:
[the documentation](https://github.com/n1crack/klad).

## Licence

Dual-licensed: [GNU AGPL v3 or later](./LICENSE), or a commercial licence for
use the AGPL does not permit — see [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md),
or email yusuf@ozdemir.be.
