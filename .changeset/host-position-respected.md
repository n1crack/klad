---
'@klad/core': patch
---

A host positioned by a stylesheet is left alone.

`position: absolute; inset: 0` is the ordinary way to make an element fill its
parent. The chart read `host.style.position` — the INLINE attribute, empty in
that case — concluded the host was unpositioned, and wrote `position: relative`
over the top. Inline beats a stylesheet, so the rule was not overridden, it was
defeated: the host collapsed to its content height, the canvas sized itself to
that, and the minimap anchored to the bottom of a chart that ended halfway up
the page.

It now reads the COMPUTED position and only steps in when there is none, which
is all it ever needed to do — the overlay, minimap and drag ghost need a
containing block, and any positioning makes one.
