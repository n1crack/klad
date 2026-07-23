---
'@klad/engine': major
'@klad/core': major
'@klad/vue': major
'@klad/react': major
---

Renamed the project to **Klad** — short for κλάδος, Greek for "branch".

Everything lives under the `@klad` scope: `@klad/core` is the frameworkless
chart you install, `@klad/vue` and `@klad/react` are the adapters, and
`@klad/engine` is the DOM-less layer underneath that only a new binding needs.
The `@n1crack/orgchart*` names are gone.

Scoped rather than an unscoped headline package, and not by preference: npm
refuses `klad` outright — "package name too similar to existing packages" —
which is a filter that applies only to unscoped names. Under a scope the name
is ours and the family reads as one word.

The API carries the name too, since a brand that appears only in the import
line is half a brand:

| Before | After |
|---|---|
| `createOrgChart()` | `createKlad()` |
| `OrgChartApi`, `OrgChartInstance`, `OrgChartEvents` | `KladApi`, `KladInstance`, `KladEvents` |
| `<OrgChart>` (Vue, React) | `<Klad>` |
| `useOrgChart()` | `useKlad()` |
| `Vue3OrgChartPlugin` | `KladPlugin` |
| `.orgchart-minimap`, `.orgchart-overlay` | `.klad-minimap`, `.klad-overlay` |

Descriptive names stay descriptive: this is still an org chart, and `Options`,
`Theme` and `NodeData` are unchanged.

Nothing was ever published under the old names, so this breaks no installed
consumer — it is a major only because the public surface is not the one the
pre-release alphas carried.
