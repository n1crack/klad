# Theme

What the **canvas** draws with. Overlay cards are your own DOM and take their
look from your own CSS; this is the box, the connector, the label and the
confirmation ring underneath them.

```ts
createOrgChart(host, {
  ...options,
  theme: { nodeFill: '#ffffff', edgeCornerRadius: 8 },
})

// or live, without touching tree state:
chart.api.setTheme({ edgeStroke: '#94a3b8' })
```

`setTheme` merges over the **current** theme, not the defaults, so an earlier
call's tokens survive unless this one overrides them too.

## Nodes

| Token | Default | |
|---|---|---|
| `nodeFill` | `'#ffffff'` | The box's fill. |
| `blockFill` | `'transparent'` | The fill at the smallest LOD tier, where nodes are shapes rather than cards. Transparent by default: at that zoom a chart of filled boxes reads as noise. |
| `nodeStroke` | `'#d4d4d8'` | |
| `nodeStrokeWidth` | `1` | |
| `cornerRadius` | `6` | World units — scales with zoom. |

## Connectors

| Token | Default | |
|---|---|---|
| `edgeStroke` | `'#d4d4d8'` | |
| `edgeWidth` | `1` | |
| `edgeCornerRadius` | `0` | Rounds the elbow. World units. Clamped per edge against that edge's own segment lengths, so a short connector's arcs never overshoot. |

## Labels

| Token | Default | |
|---|---|---|
| `labelColour` | `'#18181b'` | |
| `labelFont` | `'14px system-ui, …'` | A full CSS font shorthand. |
| `labelPadding` | `10` | Inset from the box, in world units. |

## Highlight and ring

| Token | Default | |
|---|---|---|
| `highlightFill` | `'#fef3c7'` | |
| `highlightStroke` | `'#f59e0b'` | |
| `edgeHighlightStroke` | `'#f59e0b'` | A connector whose **both** endpoints are highlighted — the edges along a highlighted path. |
| `edgeHighlightWidth` | `2.5` | Its own weight rather than `edgeWidth`: a line needs more ink than a node outline to read at the same strength. |
| `ringStroke` | `'#f59e0b'` | The one-shot confirmation flash. |
| `ringStrokeWidth` | | |
| `ringMaxOffset` | | How far the ring grows as it fades. |
| `dragGhostAlpha` | | Opacity of a node while it is being dragged. |

Setting `highlightStroke`, `edgeHighlightStroke` and `ringStroke` to one colour
is usually right: they all answer a question the user just asked, and a route
drawn in one colour but confirmed in another reads as two unrelated events.
