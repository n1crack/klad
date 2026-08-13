---
title: Theme
description: 'The canvas drawing tokens: node fill and stroke, connectors, labels, highlight and selection accents, and the branch colour palette.'
---

# Theme

What the **canvas** draws with. Overlay cards are your own DOM and take their
look from your own CSS; this is the box, the connector, the label and the
confirmation ring underneath them.

```ts
createKlad(host, {
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

| Token             | Default         |                                                                                                                                                                                                                                                        |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nodeFill`        | `'#ffffff'`     | The box's fill.                                                                                                                                                                                                                                        |
| `blockFill`       | `'transparent'` | The fill at the smallest LOD tier, where nodes are shapes rather than cards. Transparent by default: at that zoom a chart of filled boxes reads as noise.                                                                                              |
| `nodeStroke`      | `'#d4d4d8'`     |                                                                                                                                                                                                                                                        |
| `nodeStrokeWidth` | `1`             |                                                                                                                                                                                                                                                        |
| `cornerRadius`    | `6`             | World units — scales with zoom.                                                                                                                                                                                                                        |
| `hiddenMark`      | `true`          | The "there is more inside this" mark on a collapsed node — a stub and dot on the rectangular layouts, an inner arc on the wheels. Turn it off if your own card says so its own way; at a zoom where the cards are gone it is the only thing that does. |

## Connectors

| Token               | Default     |                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edgeStroke`        | `'#d4d4d8'` |                                                                                                                                                                                                                                                                                                                                                                         |
| `edgeWidth`         | `1`         |                                                                                                                                                                                                                                                                                                                                                                         |
| `edgeCornerRadius`  | `0`         | Rounds the elbow. World units. Clamped per edge against that edge's own segment lengths, so a short connector's arcs never overshoot.                                                                                                                                                                                                                                   |
| `edgeBranchColours` | `false`     | Draw each connector in the colour of the node it leads **to** instead of `edgeStroke`. Needs branch colours to exist ([below](#branch-colour)). It takes the child's own fill rather than the branch's base hue, so a branch reads as one family shading away from the root. One stroked path per distinct colour — the cost is the palette's size, not the edge count. |

## Labels

| Token          | Default               |                                     |
| -------------- | --------------------- | ----------------------------------- |
| `labelColour`  | `'#18181b'`           |                                     |
| `labelFont`    | `'14px system-ui, …'` | A full CSS font shorthand.          |
| `labelPadding` | `10`                  | Inset from the box, in world units. |

## Highlight and ring

| Token                    | Default                                                |                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `highlightFill`          | `'#fef3c7'`                                            |                                                                                                                                                                                                                                                                                                      |
| `highlightStroke`        | `'#f59e0b'`                                            |                                                                                                                                                                                                                                                                                                      |
| `edgeHighlightStroke`    | `'#f59e0b'`                                            | A connector whose **both** endpoints are highlighted — the edges along a highlighted path.                                                                                                                                                                                                           |
| `edgeHighlightWidth`     | `2.5`                                                  | Its own weight rather than `edgeWidth`: a line needs more ink than a node outline to read at the same strength.                                                                                                                                                                                      |
| `edgeHighlightGlow`      | `0`                                                    | Blur radius for a halo under the lit path, in **screen** pixels — a glow belongs to the ink, not to the diagram, and one that shrank with the camera would be gone at the zoom where pointing at a route across a big chart is worth doing. Costs one extra stroke, and only while something is lit. |
| `edgeHighlightRecolours` | `true`                                                 | Whether the lit path is repainted in `edgeHighlightStroke`, or merely widened and given the halo. Set it `false` alongside `edgeBranchColours`: recolouring throws away which branch this is at the moment the viewer is asking.                                                                     |
| `edgeFlowStroke`         | The colour of a flowing connector.                     |
| `edgeFlowWidth`          | Its weight.                                            |
| `edgeFlowDash`           | The dash pattern, in screen pixels — unscaled by zoom. |
| `edgeFlowSpeed`          | Pixels per second; negative runs the other way.        |
| `selectionStroke`        | `'#2563eb'`                                            | A selected node's outline, drawn **over** its own stroke rather than replacing it — a selected node is still whatever kind of node it was. Separate from the highlight because the two say different things and co-occur.                                                                            |
| `selectionStrokeWidth`   | `2.5`                                                  |                                                                                                                                                                                                                                                                                                      |
| `ringStroke`             | `'#f59e0b'`                                            | The one-shot confirmation flash.                                                                                                                                                                                                                                                                     |
| `ringStrokeWidth`        |                                                        |                                                                                                                                                                                                                                                                                                      |
| `ringMaxOffset`          |                                                        | How far the ring grows as it fades.                                                                                                                                                                                                                                                                  |
| `dragGhostAlpha`         |                                                        | Opacity of a node while it is being dragged.                                                                                                                                                                                                                                                         |

Setting `highlightStroke`, `edgeHighlightStroke` and `ringStroke` to one colour
is usually right: they all answer a question the user just asked, and a route
drawn in one colour but confirmed in another reads as two unrelated events.

## Branch colour

The layouts that fill their nodes — the sunburst always, anything else with
`colourBranches: true` — draw from a categorical palette rather than one node
fill.

| Token                | Default              |                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `palette`            | eight validated hues | Slot order is meaningful and is **never cycled**: a ninth branch takes `paletteOther`, not slot one. Two branches sharing a hue is a lie about the data; a branch that is visibly "not one of the named ones" is not.                                                                                                                                                      |
| `paletteOther`       | `'#9c9c96'`          | The neutral every branch past the last slot shares.                                                                                                                                                                                                                                                                                                                        |
| `hubFill`            | `'#f0efec'`          | A root — a sunburst's centre disc, the top of a file list. Neutral rather than a palette slot: the root is what the branches hang off, not one of them.                                                                                                                                                                                                                    |
| `surface`            | `'#ffffff'`          | The colour **behind** the chart. Never painted; a sunburst's sector gaps are drawn in it, so they read as the page showing through rather than as a border around every segment. Set it to your panel's own background.                                                                                                                                                    |
| `sectorGap`          | `1.5`                | The width of that gap, in screen pixels. `0` for one continuous disc.                                                                                                                                                                                                                                                                                                      |
| `labelColourInverse` | `'#ffffff'`          | The label colour used where `labelColour` would be unreadable. Sector labels pick whichever of the two has more contrast against the fill actually behind them, per sector.                                                                                                                                                                                                |
| `nodeBranchColours`  | `true`               | Whether a **node** takes its branch's colour. Off for a chart whose nodes are its own DOM cards: the canvas paints those only in the moments the overlay is not there — below the overlay threshold, and for a frame during a zoom step — and a branch-coloured slab flashing where a card was is a visible change of character. Connectors keep their colours either way. |

Going one level deeper steps a branch's own hue lighter in OKLab, so depth
reads as a ramp within one colour rather than as a new one. `DEFAULT_PALETTE`
and `DARK_PALETTE` are exported if you want to extend or reorder them — run
your own set through a contrast check first; the shipped order was chosen for
the separation of its _adjacent_ pairs, which is what a sunburst puts side by
side.

## Grid

A dot grid painted under everything, off by default.

| Token         | Default         |                                                 |
| ------------- | --------------- | ----------------------------------------------- |
| `gridDot`     | `'transparent'` | The dot colour, or `'transparent'` for no grid. |
| `gridSpacing` | `24`            | Distance between dots, in world units.          |
| `gridDotSize` | `1`             | Each dot's radius, in world units.              |

On the canvas rather than behind it, on purpose. A page can put a grid on the
element with two lines of CSS, and it will lag a frame behind the chart on
every pan: the background is composited from a style the page updates after the
fact, while the diagram is drawn from the camera the frame was rendered with.
Painted here it is one draw from one camera, and it scales with the zoom for
free.

World units, so the grid is part of the diagram — zoom out far enough and the
dots converge, so they fade out as the spacing closes rather than turning into
a wash of solid colour.

## Dark mode

Two palettes ship, both frozen `Theme` objects: `DEFAULT_THEME` and
`DARK_THEME`. Switching is one call, and it is paint-only — camera, expand
state and highlight all survive it.

```ts
import { DARK_THEME, DEFAULT_THEME } from '@klad/core'

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
const modeKeys = (Object.keys(DEFAULT_THEME) as (keyof Theme)[]).filter(
  (key) => DEFAULT_THEME[key] !== DARK_THEME[key],
)
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

- **Card shadows.** A shadow mixed from the page's text colour becomes a _halo_
  in dark mode. Cast a dark shadow in both modes; just a deeper one in dark.
- **The minimap.** Its plate, border and viewport rectangle are DOM — restyle
  them through `.klad-minimap` in your own CSS. Its silhouette is not, so
  it takes the [`silhouetteColour`](/guide/navigating#the-minimap) option.
