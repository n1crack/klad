---
'@klad/engine': minor
'@klad/core': minor
'@klad/react': minor
'@klad/vue': minor
---

`setLayoutOptions(settings, opts?)` — change how the tree is arranged after
construction, without the tree-state reset `update(data, options)` causes.

The shape itself and every knob that tunes it: `layout`, `layoutStep`,
`rowGap`, `maxRings`, `colourBranches`, `spacing`, `orientation`, `rtl`. The
same paint-only discipline `setTheme` and `setMinimap` already follow — this
is the layout-shaped hole in that set. Dragging an indent slider is not a
reason to re-collapse a tree the viewer just opened.

The camera does not move by default, because a chart that jumped to a fit on
every tick of a slider is unusable as a control. Every one of these knobs does
change how big the drawing is, though, so pass `{ fit: true }` to settle the
view once a drag ends; the fit is queued and happens after the relayout lands,
rather than against the bounds it is about to replace.

`LayoutSettings` is exported (and re-exported from the React and Vue
adapters), as are `DEFAULT_PALETTE`/`DARK_PALETTE` and `LayoutName`.
