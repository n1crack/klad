---
'@klad/react': minor
'@klad/vue': minor
---

Re-export the core types an adapter consumer has to write

Both adapters exported a hand-picked subset of `@klad/core`'s types, and the
subset was missing twelve types that appear in the API surface a consumer
writes against. The clearest case is `NodeData`: it is the type of every item
in `options.data` and of the `item` on every event payload, so it occurs in
the public surface more than any other type — and naming it meant adding
`@klad/core` as a dependency of your app. Inline object literals infer, which
is what kept this from being noticed.

`ToBlobOptions` was the sharpest: `api.toBlob(opts)` takes it as a required
argument, so calling that method meant constructing a value of a type neither
adapter exported. Both `useKlad()` implementations hand back the same `api`,
so everything reachable through it is reachable from an adapter.

Now re-exported from both `@klad/vue` and `@klad/react`: `Bounds`, `Camera`,
`ExportOpts`, `KladEvents`, `LodThresholds`, `MinimapOptions`,
`MinimapPosition`, `NodeData`, `NodeStats`, `Orientation`, `Size`,
`ToBlobOptions`, `Warning`, `ZoomLimits`, plus the `DEFAULT_NODE_SIZE` and
`DEFAULT_HISTORY` constants.

Still deliberately absent, because they belong to the frameworkless layer an
adapter replaces: `createKlad`, `createOverlay`, `OverlayItem`, and
`KladInstance` — the chart object an adapter owns and never hands over.

A packaging check now fails the build if a type core exports is reachable from
neither adapter and is not on that exclusion list, so a type added to core
later cannot go missing here by nobody remembering to add it.
