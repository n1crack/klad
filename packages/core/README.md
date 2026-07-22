# @n1crack/orgchart-core

The pure-logic layer of [OrgChart](https://github.com/n1crack/orgchart): tree
normalization, the tidy-tree layout algorithm, orientation/RTL mirroring, the
viewport (pan/zoom/inertia) math, a quadtree for hit-testing, the Canvas2D
renderer, and the typed worker protocol. No DOM dependency in the main entry,
so it can run inside a Web Worker.

Most consumers don't need this package directly — use
[`@n1crack/orgchart`](https://www.npmjs.com/package/@n1crack/orgchart)
(frameworkless) or
[`@n1crack/orgchart-vue`](https://www.npmjs.com/package/@n1crack/orgchart-vue)
instead. Depend on this package directly only if you're building a new
framework adapter; `@n1crack/orgchart`'s source is the reference
implementation to read.

```bash
npm install @n1crack/orgchart-core
```

```ts
import { normalize, layout } from '@n1crack/orgchart-core'

const tree = normalize([
  { id: 'ceo' },
  { id: 'cto', parentId: 'ceo' },
])

const sizes = new Float64Array(tree.count * 2).fill(0)
for (let i = 0; i < tree.count; i++) {
  sizes[i * 2] = 180
  sizes[i * 2 + 1] = 64
}

const { boxes, bounds } = layout(tree, sizes, { spacingX: 16, spacingY: 48 })
```

The one DOM-touching module, `ChartHost`, is exported from a separate
subpath — `@n1crack/orgchart-core/host` — rather than the main entry, so the
main entry stays importable inside the Web Worker it also ships
(`worker/chart.worker.ts`).

Full architecture notes live in the
[repository README](https://github.com/n1crack/orgchart#readme) and the
[design document](https://github.com/n1crack/orgchart/blob/main/docs/superpowers/specs/2026-07-21-orgchart-rework-design.md).

## Licence

Dual-licensed: [GNU AGPL v3 or later](./LICENSE), or a commercial licence for
use the AGPL does not permit — see [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md),
or email yusuf@ozdemir.be.
