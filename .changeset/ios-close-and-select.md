---
'@klad/engine': patch
'@klad/docs': patch
---

Three things behind a freeze reported on iOS.

**The tap that closed the picker also started a pan.** A popover's dismissing
tap should dismiss and nothing else; this one reached the chart underneath and
began a gesture. If anything then ate its `pointerup` — which dismissing a
popover on a phone is very good at — the chart was left following the finger
with no way out. The dismissal now consumes the press.

**"Go to node" was listing nine thousand options.** It is a plain `<select>`
with one entry per node, which is fine on the example it was built for and not
fine on a dataset of that size — a DOM cost on every mount, and on a phone a
native picker nobody can scroll. The wide-levels example drops it; it already
has a searchable picker that builds only the rows in view.

**A worker error froze the chart permanently.** When the worker threw, it
reported the error and never sent the frame that had been asked for — so the
main thread waited on a promise that could not settle, and since the frame loop
only asks for its next frame after that promise resolves, one error ended the
animation loop for good. It resolves now, with an empty frame, and the loop
carries on. Two renders in flight at once had the same shape and the same fix.
