---
'@klad/docs': patch
---

The playground remembers which demo you were looking at.

A reload used to drop you back on the first example whatever you had open. The
example, the framework and the layout are in the address bar now, so a refresh
lands where you were — and a link says what it shows, which is what you want
when pointing somebody at one.

`replaceState`, not `pushState`: switching example is browsing a gallery rather
than navigating, and a Back button that walks you through every demo you
glanced at is a worse Back button. Only what you actually chose goes in — the
layout appears only when it is not the example's own default, so the ordinary
URL stays short.

An unknown example id is ignored rather than treated as an error: a link to
something since renamed should still open the playground.
