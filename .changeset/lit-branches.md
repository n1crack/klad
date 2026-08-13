---
'@klad/engine': minor
'@klad/core': minor
---

Six theme tokens for a chart worth looking at, and a hook for the cards on top
of it. Every one of them defaults to what the chart already drew.

```ts
createKlad(el, {
  data,
  colourBranches: true,
  theme: {
    edgeBranchColours: true, // a connector in the colour of the node it leads to
    edgeHighlightRecolours: false, // …and it keeps that colour while lit
    edgeHighlightGlow: 3, // a halo under the lit route, in screen pixels
    nodeBranchColours: false, // the cards are your own DOM; leave the boxes alone
    hiddenMark: false, // and they say "more inside" their own way
    gridDot: 'rgba(128, 132, 148, 0.3)', // a dot grid, painted on the canvas
    gridSpacing: 26,
    gridDotSize: 1,
  },
})
```

- `edgeBranchColours` takes the CHILD's own fill rather than a branch base
  colour, so a branch reads as one family shading away from the root. Drawn as
  one stroked path per distinct colour — the cost is the palette's size, not
  the edge count.
- `edgeHighlightRecolours: false` is what makes that worth having: recolouring
  a lit route throws away which branch it is at the moment somebody is asking.
  A highlight now also fades in and out rather than switching on.
- `gridDot` and its two sizes draw the grid on the canvas rather than behind
  it. A grid in CSS is composited from a style the page updates after the fact,
  while the diagram comes from the camera the frame was rendered with — so it
  lags a frame behind on every pan. Here it is one draw from one camera.
- The overlay root carries `data-klad-moving` while the chart animates. A
  toggle slides every card under a pointer that has not moved, so the browser
  fires `:hover` on each one in turn; the attribute is how your CSS can decline
  to animate on that.
