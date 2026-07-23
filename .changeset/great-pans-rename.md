---
'@klad/core': major
'klad': major
'@klad/vue': major
'@klad/react': major
---

Renamed the project to **Klad** — short for κλάδος, Greek for "branch".

Packages are `klad`, `@klad/core`, `@klad/vue` and `@klad/react` — the
`@n1crack/orgchart*` names are gone. The headline package is unscoped so the
install line is as short as the name, and the adapters sit under the matching
`@klad` scope, so the whole family reads as one word rather than a word plus a
different word for its scope.

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
