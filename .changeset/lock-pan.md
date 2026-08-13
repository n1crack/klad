---
'@klad/core': minor
---

`lockPan` — hold the chart centred and refuse to pan.

```ts
createKlad(el, { data, layout: 'sunburst', lockPan: true, zoomLimits: { minK: 0.35, maxK: 6 } })
chart.api.setLockPan(false) // live, and it re-centres on the spot
```

For a diagram that IS its bounds — a sunburst, a radial — where a pan can only
take a disc that was already fully on screen off the side of it, and where the
camera coming to rest somewhere arbitrary is the one state a centred design has
no answer for. Zoom still works, anchored on the middle of the viewport rather
than on the pointer, since a lock is precisely the discarding of the
translation `zoomAt` solves for.

It survives the diagram changing size, which is the case it exists for: a
sunburst drilled into is a different disc, and one held at the previous disc's
centre sits off to one side.
