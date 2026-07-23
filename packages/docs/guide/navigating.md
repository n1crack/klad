# Navigating

A large chart is mostly off screen. What matters is how you get to a specific
node and how you keep your bearings once you are there.

## Go to a node

```ts
chart.api.focus('lead-42')
```

`focus` opens every collapsed ancestor on the way, then centres the node. It
works from a fully collapsed chart, which is the case it exists for: it waits
for the layout that expanding produced rather than reading a position that
does not exist yet. When nothing needed expanding, the move happens
immediately.

Add a confirmation flash on arrival:

```ts
chart.api.focus('lead-42', { ring: true })
```

The ring fires when the camera gets there, not when it sets off, so the whole
flash happens where you are looking. It is off by default — stepping through
search results in a loop should move the camera, not strobe.

## Showing the way

`pathTo` returns the chain of ids from the root down to a node, inclusive:

```ts
chart.api.pathTo('lead-42') // ['ceo', 'cto', 'eng', 'lead-42']
```

Which is exactly what `highlight` wants:

```ts
chart.api.highlight(chart.api.pathTo('lead-42'))
chart.api.focus('lead-42', { ring: true })
```

A connector is drawn in the highlight colour when **both** of its endpoints are
highlighted. For a root-to-node chain that is precisely the route and nothing
else — a highlighted node's other children are not themselves highlighted, so
their connectors stay quiet. Scattered highlights (a search result) light the
nodes without inventing a path between them.

`highlight(null)` clears it.

## Search

```ts
const results = chart.api.search('chen')
// [{ id, item, path }, ...]
```

Substring match on the node's label by default, or pass your own predicate:

```ts
chart.api.search((item) => item.department === 'Design' && item.level > 3)
```

Each result carries its own `path`, so a result list can show where a match
sits without a second call.

## Camera

| Call | What it does |
|---|---|
| `fit()` | Zooms out far enough to show the whole visible tree. |
| `reset()` | Back to the opening view. |
| `zoomIn()` / `zoomOut()` | One step, about the centre. |
| `zoomTo(k)` | An exact scale. |
| `focus(id, opts?)` | Centres a node, opening the way to it. |

Every one of them eases rather than jumping, and every one is interrupted the
instant a user's hand touches the canvas — dragging always wins immediately.

## Gestures

| Gesture | |
|---|---|
| Drag with the primary button, or one finger | Pan. A release with speed coasts to a stop. |
| Wheel or trackpad scroll | Zoom about the pointer. |
| Two fingers | Pinch to zoom about the midpoint. |
| Right or middle button | Nothing. Yours — a right-click reaches your own `contextmenu` handler with the chart holding still under it. |

The host element is given `touch-action: none` while a chart is mounted, and
it is handed back on `destroy()`. That is what makes a one-finger drag pan the
chart instead of scrolling the page, and a pinch zoom the camera instead of the
whole document. Text selection is suppressed on the host for the same reason —
a pan that starts on a card would otherwise drag-select its label — while
buttons, links and form controls inside a card keep working normally.

## Expanding and collapsing

```ts
chart.api.expand('cto')          // just this node
chart.api.expand('cto', true)    // and everything below it
chart.api.collapse('cto', true)
chart.api.expandAll()
chart.api.collapseAll()
chart.api.expandTo('lead-42')    // open the ancestors, without moving the camera
```

A single-node toggle keeps that node pinned exactly where it was on screen
while the rest of the layout moves around it — to the pixel, on both the
worker and main-thread paths. Turn it off with `autoPanOnToggle: false` if you
would rather the camera stayed still and the tree moved under it.

## The minimap

```ts
minimap: true
minimap: { position: 'top-left', width: 200, height: 140 }
minimap: { silhouetteColour: '#94a3b8' } // for a dark host
```

It draws a silhouette of the occupied area rather than a shrunken chart —
at that scale individual boxes fall below a pixel — with the current viewport
as a rectangle over it. Click or drag inside it to pan.

The plate, its border and the viewport rectangle are ordinary DOM — style
them from your own CSS via `.klad-minimap`. The silhouette is not: it is
written pixel by pixel into a canvas, so it is the one part that needs an
option, `silhouetteColour`. The default slate reads well on a light plate and
disappears on a dark one, so a dark theme should set it. Only the colour's RGB
is used; each pixel's alpha is the silhouette's own coverage.

Its frame is held steady across an expand or collapse rather than refitting to
whatever is currently open: a minimap whose scale lurched on every toggle
would be a zoom rather than a map, and nothing would stay where you last saw
it.
