---
'@klad/core': minor
'@klad/vue': minor
'@klad/react': minor
'@klad/engine': minor
---

Keyboard control of the camera, `fitSubtree(id)`, and saveable views.

**Keyboard.** Clicking a chart and pressing an arrow key used to do nothing:
the host was not focusable and no key was bound outside the hidden
accessibility tree, so the only way in was fourteen presses of Tab. The chart
is now a tab stop — the first one inside itself — and answers to arrows (Shift
for a stride), `+`/`-`, `f`, `0`, `Home` and `Esc`. Keys are left alone when
focus is inside an input, a `<select>`, or a row of the accessibility tree,
which has its own arrows for moving between nodes rather than moving the view.
`keyboard: false` opts out, including the tab stop.

**`fitSubtree(id)`.** Frames one branch rather than the whole chart. On a chart
of tens of thousands of nodes, fitting everything means a zoom level where
nothing can be read; "show me Engineering" is the question people have.

**`getView()` / `setView(view)`.** Where a viewer is — camera, open branches,
highlight — as one plain serialisable object naming nodes by id. Put it in a
URL and you have a link to a place in a chart; ids that have since left the
tree are ignored rather than throwing, so an old bookmark still opens.
`ChartState` gained `highlighted` for the same reason.
