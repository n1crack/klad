# @n1crack/orgchart

The frameworkless API for [OrgChart](https://github.com/n1crack/orgchart) — an
org chart library that renders 5,000–50,000 nodes at 60fps by laying out and
drawing the tree on a `<canvas>` inside a Web Worker, overlaying real DOM only
for the nodes currently on screen and zoomed in far enough to read.

This package is one function.

```bash
npm install @n1crack/orgchart
```

```ts
import { createOrgChart, type Options } from '@n1crack/orgchart'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
  ],
  nodeSize: { w: 180, h: 64 }, // required — layout runs in a worker with no DOM to measure
  label: (item) => String(item.name ?? ''),
  renderNode(element, context) {
    element.innerHTML = `<strong>${String(context.item.name ?? '')}</strong>`
  },
}

const chart = createOrgChart(document.getElementById('chart')!, options)
chart.on('nodeClick', ({ id, item }) => console.log(id, item))
// chart.destroy() when done
```

Using Vue? Use [`@n1crack/orgchart-vue`](https://www.npmjs.com/package/@n1crack/orgchart-vue)
instead — it's built on this package and adds a `#node` scoped slot.

Guide, API reference and roadmap:
[the documentation](https://github.com/n1crack/orgchart).

## Licence

Dual-licensed: [GNU AGPL v3 or later](./LICENSE), or a commercial licence for
use the AGPL does not permit — see [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md),
or email yusuf@ozdemir.be.
