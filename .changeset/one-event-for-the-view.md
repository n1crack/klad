---
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

`viewChange` — one event for the whole view.

```ts
chart.on('viewChange', (view) => store.save(view))   // straight back into setView
```

Camera, open branches, selection, highlight, isolation, filter and lifted caps,
in one payload, exactly what `getView()` returns. Mirroring the chart into a
store used to mean subscribing to several events and merging them back into the
picture they came from.

It fires when any of it changes and never for a redraw that changed nothing, so
panning does not flood it.

This is deliberately not a step toward controlled state. Whether a branch is
open is a fact about the screen rather than about your data, and routing every
toggle through your store would put a framework render inside a 16ms
interaction — worse, `loadChildren` makes opening a node asynchronous and
data-changing, so that round trip would grow a second leg. The chart keeps
holding it and now says what it holds.

**Two notes on size, one of which corrects the docs.**

The `open` array names every open node, so a whole view fits in a URL on a small
chart and does not on a large one. The documentation said "put one in a URL and
you have a link to a place in a chart" without that caveat; it now says to take
the small parts (`camera`, `isolated`, `filter`) for a link and use storage for
a full restore. `setView` fills in whatever is left out.

And that array is **frozen and shared between emissions**. It is rebuilt only
when the open state actually changes, which is what keeps an event that fires
per frame affordable at fifty thousand nodes — sorting it in place would corrupt
that, so it cannot be. Copy it if you need to reorder.
