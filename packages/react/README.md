# @klad/react

[![npm](https://img.shields.io/npm/v/@klad/react?color=cb3837&logo=npm&logoColor=white&label=npm)](https://www.npmjs.com/package/@klad/react)
[![gzip size](https://img.shields.io/bundlejs/size/@klad/react?label=gzip)](https://bundlejs.com/?q=%40klad%2Freact)
[![licence](https://img.shields.io/npm/l/@klad/react?label=licence)](https://github.com/n1crack/klad/blob/main/LICENSE)

The React adapter for [Klad](https://github.com/n1crack/klad) — a tree
engine that stays smooth where a chart made of elements cannot, by laying out and
drawing the tree on a `<canvas>` inside a Web Worker, mounting real React
components only for the nodes currently on screen and zoomed in far enough to
read.

```bash
npm install @klad/react
```

Peer dependency: `react >=18`.

```tsx
import { Klad, type Options } from '@klad/react'

const options: Options = {
  data: [
    { id: 'ceo', name: 'Jamie Fox', title: 'CEO' },
    { id: 'cto', parentId: 'ceo', name: 'Amy Chen', title: 'CTO' },
    { id: 'cfo', parentId: 'ceo', name: 'Priya Rao', title: 'CFO' },
  ],
}

export function Chart() {
  return (
    <Klad options={options} style={{ width: '100%', height: '100vh' }}>
      {({ item, hasChildren, open, toggle }) => (
        <div className="card">
          <strong>{String(item.name)}</strong>
          {hasChildren && (
            <button type="button" onClick={toggle}>
              {open ? '−' : '+'}
            </button>
          )}
        </div>
      )}
    </Klad>
  )
}
```

The render prop is called for the ~50 nodes in the viewport, into pooled
elements reused across frames — never once per node in the tree. Omit it
entirely and no overlay DOM is created at all.

Reach the imperative API through a `ref` on `<Klad>`
(`chartRef.current?.api`).

Guide, API reference and roadmap:
[the documentation](https://github.com/n1crack/klad).

## Licence

Dual-licensed: [GNU AGPL v3 or later](./LICENSE), or a commercial licence for
use the AGPL does not permit — see [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md),
or email yusuf@ozdemir.be.
