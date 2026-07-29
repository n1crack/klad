---
'@klad/core': patch
'@klad/docs': patch
---

Two fixes, one of them for a freeze reported on iOS.

**A gesture that never ended left the chart stuck.** `pointerup` and
`pointercancel` both finish a drag, so it should not be possible — but a
browser that takes a gesture away without saying so left this layer claiming
the pointer indefinitely, after which every move panned the camera and nothing
worked again until a reload. The next press now ends a stale gesture instead of
adding to it.

**The playground link on the docs home page 404'd.** It was a markdown link, so
VitePress handed it to its own router, which has no page for it — the
playground is a separate app copied in under `public/`, not a VitePress route.
The nav entry has carried `target: '_self'` for exactly this reason since it
was added; the one in the page body did not.

Also defensive, for the same iOS report: the overflow picker now blurs its
search field before it closes and removes itself on the next task rather than
inside the event that dismissed it. Removing the node holding a focused input,
from inside a `pointerdown`, leaves Safari trying to scroll an element that no
longer exists into view while it is also dismissing the on-screen keyboard.
