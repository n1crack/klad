/**
 * Renders `public/og.png`, the 1200×630 card that link previews show.
 *
 * Generated rather than hand-drawn, and checked in rather than built on every
 * deploy: it has to exist as a static file at a stable URL for a crawler to
 * fetch, and regenerating it on each build would churn a binary in git for no
 * change. Re-run it — `node scripts/build-og-image.mjs` — when the wording or
 * the mark changes.
 *
 * Chromium does the drawing because it is already here for the test suites,
 * and because the card is HTML: the same fonts, the same mark, the same blue
 * as the site, with no second toolchain to keep in step.
 */
import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '..', 'public')

const mark = await readFile(join(publicDir, 'logo-hero.svg'), 'utf8')

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 1200px;
        height: 630px;
        display: flex;
        align-items: center;
        gap: 72px;
        padding: 0 96px;
        background: #ffffff;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        color: #0f172a;
        overflow: hidden;
      }
      /* The same restrained glow the hero uses, at the same low opacity: it
         should read as light behind the mark, not as a sticker around it. */
      .mark {
        position: relative;
        flex: 0 0 auto;
        width: 300px;
        height: 300px;
        display: grid;
        place-items: center;
      }
      .mark::before {
        content: '';
        position: absolute;
        inset: -8%;
        border-radius: 50%;
        background: radial-gradient(closest-side, rgba(37, 99, 235, 0.18), transparent 72%);
        filter: blur(28px);
      }
      .mark svg { position: relative; width: 260px; height: 260px; }
      .copy { display: flex; flex-direction: column; gap: 20px; }
      h1 { font-size: 84px; font-weight: 800; letter-spacing: -0.035em; line-height: 1; }
      p { font-size: 34px; line-height: 1.32; color: #475569; max-width: 15ch; font-weight: 500; }
      .rule { width: 96px; height: 6px; border-radius: 3px; background: #2563eb; }
    </style>
  </head>
  <body>
    <div class="mark">${mark}</div>
    <div class="copy">
      <h1>OrgChart</h1>
      <div class="rule"></div>
      <p>50,000 nodes. 60fps.</p>
    </div>
  </body>
</html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'load' })
await writeFile(join(publicDir, 'og.png'), await page.screenshot({ type: 'png' }))
await browser.close()

console.log('wrote public/og.png')
