---
'@klad/core': minor
'@klad/vue': minor
'@klad/react': minor
'@klad/engine': minor
---

Selection: `select(ids)`, `getSelection()`, a `selectionChange` event, and
pointer selection behind `selection: true`.

What the viewer picked, kept separate from what `highlight` says the chart is
pointing at. The two co-occur constantly — select three people, then search —
so they are stored separately and drawn differently, through new
`selectionStroke` / `selectionStrokeWidth` theme tokens. A selected node keeps
its own outline underneath and is drawn at every zoom, including the tier where
unselected nodes are shapes.

With `selection: true`, the pointer selects: click replaces, ctrl/cmd-click
toggles one, shift-click adds, shift-drag draws a box, alt-drag draws a lasso,
a click on the background clears, and `Esc` clears both selection and
highlight. Off by default, because a chart written before this existed already
has a meaning for a click.

Also fixes the minimap after `isolate`: it held its old frame, so an isolated
branch was drawn at the whole chart's scale, in the corner the whole chart used
to occupy.
