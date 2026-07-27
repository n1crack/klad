---
'@klad/core': minor
'@klad/vue': minor
'@klad/react': minor
---

Three things a drag could not do.

**Closed branches spring open.** Rest the pointer on a collapsed node for
about half a second and it opens, so you can carry on into it. Before this a
closed branch was a wall — its children are off screen, so there was nothing
to aim at, and no way to open one while the gesture had both your hands. What
sprang open closes again when you let go, except the branch the drop actually
landed in: wandering across six folders on the way to the seventh should not
leave all seven standing open.

**Escape puts the node back down.** No `nodeDrop`, nothing moved. The same
path now handles `pointercancel`, which used to route to the same place as
`pointerup` — so a gesture the browser reclaimed, a touch it decided was a
page scroll, restructured the tree on its way out.

**The cursor answers "will this be taken?"** `grabbing` while dragging,
`no-drop` over a target that would refuse. Set by the chart on its own host
and canvas, with cards taken out of the pointer's way for the length of the
gesture — so it works without the host writing any CSS. `.klad-dragging` and
`.klad-drag-refused` are still on the host for anyone who wants a different
look.

Also: `NodeDropEvent` is now exported from every package. Typing a `nodeDrop`
handler meant digging the shape out of `KladEvents['nodeDrop']`, which is not
a thing anyone should have to do to write the one handler this feature is
about.
