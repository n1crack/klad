/**
 * Renders the site's two raster images from one scene:
 *
 *   public/hero.png  — transparent, for the home page's hero slot
 *   public/og.png    — 1200×630, opaque, for link previews
 *
 * Both are drawn in Chromium from HTML/CSS, which is already here for the test
 * suites. That buys real perspective, layered shadows and gradients — a flat
 * SVG mark cannot suggest depth, and this is the one image whose whole job is
 * to look like something worth clicking.
 *
 * Rendered at 2× and checked in: a crawler needs the card at a stable URL, and
 * regenerating on every build would churn a binary for no change. Re-run with
 * `pnpm --filter @klad/docs images` after changing the scene.
 */
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public')

/**
 * The scene: a small chart tilted back and rotated, its cards lifted off the
 * plane by different amounts so the hierarchy reads as depth rather than as a
 * diagram. Card colour follows depth — the root darkest, leaves lightest —
 * the same ordering the flat mark uses.
 */
const SCENE_CSS = `
  .scene {
    position: relative;
    width: 900px;
    height: 700px;
    display: grid;
    place-items: center;
  }

  /* Wider than the board and much weaker than it: the board should read as
     lit from behind, not as a sticker on a patch of colour.
     
     Opt-in, because it must NOT be baked into the transparent hero PNG. A
     blurred gradient composited against transparency quantises into visible
     rings in the alpha channel — it looks like a target, not a glow. The site
     draws the hero's glow in CSS behind the image instead, where it has an
     opaque page to blend with. */
  .scene.glow::before {
    content: '';
    position: absolute;
    width: 760px;
    height: 560px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgba(37, 99, 235, 0.26), rgba(37, 99, 235, 0) 72%);
    filter: blur(52px);
  }

  .board {
    position: relative;
    width: 600px;
    height: 460px;
    /* A gentle tilt, not an isometric slam. Past about 30 degrees of rotateX
       the cards flatten into sticks and the tree stops reading as a tree —
       the depth arrives but the subject leaves. */
    transform: perspective(1600px) rotateX(17deg) rotateY(-21deg) rotateZ(2deg);
    transform-style: preserve-3d;
  }

  /**
   * A card is a slab, not a rectangle. The stacked hard-edged shadows below
   * are its extruded side: each one is the same shape offset a pixel further
   * down-and-right in the card's OWN space, so once the board is tilted they
   * line up into a visible thickness rather than a blur. That is what gives
   * the picture volume; a flat fill with a soft shadow only ever looks like
   * paper lying on a desk.
   */
  .card {
    position: absolute;
    border-radius: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 18px;
    transform-style: preserve-3d;
  }

  .avatar {
    width: 34px; height: 34px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.94);
    flex: none;
  }
  .lines { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
  .line { height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.95); }
  .line.short { width: 52%; background: rgba(255, 255, 255, 0.6); }

  .rank0 {
    background: linear-gradient(150deg, #2563eb, #60a5fa);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.4),
      2px 2px 0 #1e40af, 4px 4px 0 #1e40af, 6px 6px 0 #1e40af,
      8px 8px 0 #1e3a8a, 10px 10px 0 #1e3a8a, 12px 12px 0 #1e3a8a,
      34px 44px 60px rgba(15, 23, 42, 0.3);
  }
  .rank1 {
    background: linear-gradient(150deg, #3b82f6, #93c5fd);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.45),
      2px 2px 0 #2563eb, 4px 4px 0 #2563eb, 6px 6px 0 #1d4ed8,
      8px 8px 0 #1d4ed8, 10px 10px 0 #1d4ed8,
      28px 36px 48px rgba(15, 23, 42, 0.26);
  }
  .rank2 {
    background: linear-gradient(150deg, #60a5fa, #bfdbfe);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.5),
      2px 2px 0 #3b82f6, 4px 4px 0 #3b82f6, 6px 6px 0 #2563eb,
      8px 8px 0 #2563eb,
      22px 28px 38px rgba(15, 23, 42, 0.22);
  }

  /* Connectors sit on the plane with no lift, so the slabs visibly stand
     above the structure joining them. Given a thickness of their own too —
     a hairline under a 12px slab reads as a mistake. */
  .link {
    position: absolute;
    background: #94a3b8;
    border-radius: 4px;
    transform: translateZ(3px);
    box-shadow: 2px 2px 0 #64748b;
  }
`

/** One card. `z` is how far it is lifted off the plane. */
const card = ({ x, y, w, h, rank, z, content = '' }) =>
  `<div class="card rank${rank}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:translateZ(${z}px)">${content}</div>`

const PERSON = '<span class="avatar"></span><span class="lines"><span class="line"></span><span class="line short"></span></span>'
const LINES_ONLY = '<span class="lines"><span class="line"></span><span class="line short"></span></span>'

const link = (x, y, w, h) => `<div class="link" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`

/** A parent's fan-out: trunk down, a bus across its children, a drop to each. */
const fan = (parentX, parentBottom, childTop, childXs) => {
  const busY = parentBottom + (childTop - parentBottom) / 2
  const first = Math.min(...childXs)
  const last = Math.max(...childXs)
  return [
    link(parentX - 4, parentBottom, 8, busY - parentBottom),
    link(first - 4, busY - 4, last - first + 8, 8),
    ...childXs.map((x) => link(x - 4, busY, 8, childTop - busY)),
  ].join('')
}

const scene = (glow) => `
  <div class="scene${glow ? ' glow' : ''}">
    <div class="board">
      ${fan(300, 96, 200, [130, 470])}
      ${fan(130, 282, 380, [40, 220])}
      ${link(466, 282, 8, 98)}

      ${card({ x: 180, y: 0, w: 240, h: 96, rank: 0, z: 96, content: PERSON })}

      ${card({ x: 40, y: 200, w: 180, h: 82, rank: 1, z: 58, content: PERSON })}
      ${card({ x: 380, y: 200, w: 180, h: 82, rank: 1, z: 58, content: PERSON })}

      ${card({ x: 0, y: 380, w: 150, h: 64, rank: 2, z: 24, content: LINES_ONLY })}
      ${card({ x: 180, y: 380, w: 150, h: 64, rank: 2, z: 24, content: LINES_ONLY })}
      ${card({ x: 390, y: 380, w: 150, h: 64, rank: 2, z: 24, content: LINES_ONLY })}
    </div>
  </div>
`

const page = (body, css) => `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
  ${SCENE_CSS}
  ${css}
</style></head><body>${body}</body></html>`

const browser = await chromium.launch()

// --- hero: the scene alone, transparent, so it sits on either theme ---------
{
  const p = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 })
  await p.setContent(page(scene(false), 'body { background: transparent; }'), { waitUntil: 'load' })
  await writeFile(join(publicDir, 'hero.png'), await p.screenshot({ type: 'png', omitBackground: true }))
  await p.close()
}

// --- og: the link preview ---------------------------------------------------
//
// A link preview is read at thumbnail size, in a feed, by someone who has not
// heard of this. So it says what the thing IS, in the fewest words that are
// actually true of it — not what it scores. A benchmark on a card is a claim
// the reader cannot check and half of them have learnt to discount; the
// division of labour between their components and this canvas is the whole
// idea, and it survives being read in one second.
//
// Dark, because the picture is a lit object and a dark ground is what makes it
// glow rather than sit. The scene runs off the right edge on purpose: an image
// that is fully contained reads as a diagram, one that is cropped reads as a
// window onto something larger, which is the honest description of a chart
// this size.
{
  // The site's own mark, inlined rather than fetched: this file must render
  // with no server and no network, and `public/logo.svg` is the same drawing.
  const MARK = `<svg viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <linearGradient id="face" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="#3b82f6" /><stop offset="1" stop-color="#60a5fa" />
      </linearGradient>
      <linearGradient id="leaf" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="#60a5fa" /><stop offset="1" stop-color="#93c5fd" />
      </linearGradient>
    </defs>
    <g fill="none" stroke="#94a3b8" stroke-width="3" stroke-linecap="round">
      <path d="M24 18v5" /><path d="M11 30v-7h26v7" />
    </g>
    <rect x="15" y="9" width="22" height="11" rx="3.5" fill="#1e40af" />
    <rect x="13" y="6" width="22" height="11" rx="3.5" fill="url(#face)" />
    <rect x="6" y="32" width="15" height="10" rx="3" fill="#2563eb" />
    <rect x="4" y="30" width="15" height="10" rx="3" fill="url(#leaf)" />
    <rect x="31" y="32" width="15" height="10" rx="3" fill="#2563eb" />
    <rect x="29" y="30" width="15" height="10" rx="3" fill="url(#leaf)" />
  </svg>`

  const css = `
    body {
      position: relative;
      width: 1200px; height: 630px;
      background: #0b1220;
      color: #f8fafc;
      overflow: hidden;
    }

    /* Two lights, both behind the subject: a cool one at the top left where
       the wordmark sits, and the accent one at the right where the chart is,
       so the slabs have something to be lit BY. Blurred at this size rather
       than drawn as gradients, which would band. */
    body::before, body::after {
      content: ''; position: absolute; border-radius: 50%;
    }
    body::before {
      width: 900px; height: 700px; left: -280px; top: -320px;
      background: radial-gradient(closest-side, rgba(37, 99, 235, 0.30), transparent 70%);
    }
    body::after {
      width: 1000px; height: 900px; right: -260px; top: -180px;
      background: radial-gradient(closest-side, rgba(56, 130, 246, 0.26), transparent 70%);
    }

    .copy {
      position: relative;
      width: 690px; height: 100%;
      /* Bottom padding clears the footer line, which is positioned against the
         card rather than sitting in this column — the pills would otherwise
         come to rest on top of it. */
      padding: 56px 0 118px 72px;
      display: flex; flex-direction: column;
    }

    .brand { display: flex; align-items: center; gap: 16px; }
    .brand svg { width: 52px; height: 52px; display: block; }
    .brand .name { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
    .brand .what { font-size: 16px; font-weight: 500; color: #94a3b8; letter-spacing: 0.01em; }

    .eyebrow {
      margin-top: 56px;
      font-size: 17px; font-weight: 700; letter-spacing: 0.22em;
      text-transform: uppercase; color: #60a5fa;
    }

    h1 {
      margin-top: 18px;
      font-size: 68px; font-weight: 800; letter-spacing: -0.035em; line-height: 1.06;
    }
    h1 .accent { color: #60a5fa; }

    .sub {
      margin-top: 20px;
      font-size: 21px; font-weight: 500; line-height: 1.45; color: #cbd5e1;
      max-width: 30ch;
    }

    /* The specifics, small: nobody reads these at thumbnail size, and everybody
       reads them once the image is opened. */
    .pills { margin-top: auto; display: flex; gap: 10px; }
    .pill {
      padding: 9px 16px; border-radius: 999px;
      font-size: 15px; font-weight: 600; color: #cbd5e1;
      background: rgba(148, 163, 184, 0.10);
      border: 1px solid rgba(148, 163, 184, 0.22);
      white-space: nowrap;
    }

    .foot {
      position: absolute; left: 72px; right: 56px; bottom: 40px;
      display: flex; align-items: center; justify-content: space-between;
      font-size: 16px; font-weight: 600; color: #94a3b8;
    }
    .foot .dot { color: #475569; margin: 0 12px; }
    .foot .right { display: flex; gap: 10px; }
    .badge {
      padding: 8px 16px; border-radius: 999px; font-size: 15px; font-weight: 700;
      border: 1px solid rgba(148, 163, 184, 0.28); color: #cbd5e1;
    }
    .badge.star { border-color: rgba(96, 165, 250, 0.55); color: #93c5fd; }

    /* Off the right edge, and larger than the box that holds it: the crop is
       the point; overflow: hidden on the body does the cutting. */
    .art {
      position: absolute; right: -150px; top: 50%;
      transform: translateY(-50%) scale(0.92);
      transform-origin: center;
    }
  `

  const body = `
    <div class="copy">
      <div class="brand">
        ${MARK}
        <div>
          <div class="name">klad</div>
          <div class="what">org chart for very large trees</div>
        </div>
      </div>

      <div class="eyebrow">Canvas org chart</div>
      <h1>Your components,<br /><span class="accent">one canvas.</span></h1>
      <div class="sub">Vue, React or plain DOM on top. Layout and drawing in a Web&nbsp;Worker underneath.</div>

      <div class="pills">
        <span class="pill">TypeScript</span>
        <span class="pill">Vue &amp; React</span>
        <span class="pill">Minimap</span>
        <span class="pill">SVG · PNG export</span>
      </div>
    </div>

    <div class="foot">
      <span>klad.ozdemir.be<span class="dot">·</span>github.com/n1crack/klad</span>
      <span class="right">
        <span class="badge">AGPL · Commercial</span>
        <span class="badge star">★ Star</span>
      </span>
    </div>

    <div class="art">${scene(false)}</div>
  `
  const p = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })
  await p.setContent(page(body, css), { waitUntil: 'load' })
  await writeFile(join(publicDir, 'og.png'), await p.screenshot({ type: 'png' }))
  await p.close()
}

await browser.close()
console.log('wrote public/hero.png and public/og.png')
