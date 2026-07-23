# @klados/react

The React adapter for [Klados](https://github.com/n1crack/klados) — an org
chart library that renders 5,000–50,000 nodes at 60fps by laying out and
drawing the tree on a `<canvas>` inside a Web Worker, mounting real React
components only for the nodes currently on screen and zoomed in far enough to
read.

```bash
npm install @klados/react
```

Peer dependency: `react >=18`.

```tsx
import { Klados, type Options } from '@klados/react'

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
    <Klados options={options} style={{ width: '100%', height: '100vh' }}>
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
    </Klados>
  )
}
```

The render prop is called for the ~50 nodes in the viewport, into pooled
elements reused across frames — never once per node in the tree. Omit it
entirely and no overlay DOM is created at all.

Reach the imperative API through a `ref` on `<Klados>`
(`chartRef.current?.api`).

Guide, API reference and roadmap:
[the documentation](https://github.com/n1crack/klados).

## Licence

Dual-licensed: [GNU AGPL v3 or later](./LICENSE), or a commercial licence for
use the AGPL does not permit — see [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md),
or email yusuf@ozdemir.be.
