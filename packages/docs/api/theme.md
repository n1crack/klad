# Theme

What the **canvas** draws with. Overlay cards are your own DOM and take their
look from your own CSS; this is the box, the connector, the label and the
confirmation ring underneath them.

```ts
createKlados(host, {
  ...options,
  theme: { nodeFill: '#ffffff', edgeCornerRadius: 8 },
})

// or live, without touching tree state:
chart.api.setTheme({ edgeStroke: '#94a3b8' })
```

`setTheme` merges over the **current** theme, not the defaults, so an earlier
call's tokens survive unless this one overrides them too.

Every token below has a default; the tables give the light one. `DEFAULT_THEME`
and `DARK_THEME` are both exported, ready to spread — see
[Dark mode](#dark-mode).

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

## Dark mode

Two palettes ship, both frozen `Theme` objects: `DEFAULT_THEME` and
`DARK_THEME`. Switching is one call, and it is paint-only — camera, expand
state and highlight all survive it.

```ts
import { DARK_THEME, DEFAULT_THEME } from 'klados'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const apply = () => chart.api.setTheme(media.matches ? DARK_THEME : DEFAULT_THEME)
apply()
media.addEventListener('change', apply)
```

`setTheme` merges, so pushing a whole palette also resets anything you set
yourself earlier. If your app has its own theme tokens on top — a brand accent,
a heavier connector — either re-apply them after the switch or push only the
tokens that actually differ between the two:

```ts
const modeKeys = (Object.keys(DEFAULT_THEME) as (keyof Theme)[])
  .filter((key) => DEFAULT_THEME[key] !== DARK_THEME[key])
```

### Cards must agree with the box underneath them

The one part that is not a matter of taste. Your overlay cards are DOM sitting
on top of a node box the canvas has already painted, so `nodeFill` and
`cornerRadius` are not decoration — they are the colour and radius your card's
own CSS has to have. Where they disagree, the canvas's box shows around the
card: a halo at each corner where two different radii part company, or, with a
light theme left under dark cards, a white slab behind every one of them.

Drive both from one value rather than setting them twice:

```ts
document.documentElement.style.setProperty('--node-bg', theme.nodeFill)
document.documentElement.style.setProperty('--node-radius', `${theme.cornerRadius}px`)
chart.api.setTheme(theme)
```

```css
.my-card {
  background: var(--node-bg);
  border-radius: var(--node-radius);
}
```

An example that deliberately wants no box at all — a floating avatar, say —
sets `nodeFill: 'transparent'` and `nodeStroke: 'transparent'` instead, and
then has nothing to match.

### The rest of the page

Two things outside this table also carry the mode:

- **Card shadows.** A shadow mixed from the page's text colour becomes a *halo*
  in dark mode. Cast a dark shadow in both modes; just a deeper one in dark.
- **The minimap.** Its plate, border and viewport rectangle are DOM — restyle
  them through `.klados-minimap` in your own CSS. Its silhouette is not, so
  it takes the [`silhouetteColour`](/guide/navigating#the-minimap) option.
