---
'@klad/engine': minor
'@klad/core': minor
---

Expand/collapse fixes.

- The toggled node now stays where it was clicked for the whole transition: a click, a hand-drift or a drag can no longer walk the camera off, and rapid clicking cannot ratchet it away.
- A click resolves against what is on screen, not the layout the chart is heading for, so it toggles the card you aimed at mid-animation.
- Children caught mid-reveal or mid-collapse are carried at the position they were drawn at, instead of jumping to full size or onto their parent's box.
- Children grow out of the tip below their own parent, at every depth.
- Siblings pack the same distance apart whichever one has children.
- The two animation phases overlap more, so an open or close reads as one move (450ms → 390ms).
