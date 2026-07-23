import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type HeadConfig } from 'vitepress'
import { tabsMarkdownPlugin } from 'vitepress-plugin-tabs'

/**
 * Where the site will actually live. Both are overridable from the
 * environment so deploying somewhere else — a project page under a subpath, a
 * custom domain — is a deploy-time decision rather than a commit:
 *
 *   DOCS_URL=https://klad.example DOCS_BASE=/docs/ pnpm --filter @klad/docs build
 *
 * `SITE_URL` matters beyond tidiness: `og:image` and `og:url` have to be
 * absolute, because the crawler fetching them has no page to resolve a
 * relative path against.
 */
// Origin only — the path comes from `BASE`, and putting it in both is how you
// get `/klad/klad/` in every canonical link.
const SITE_URL = (process.env.DOCS_URL ?? 'https://klad.ozdemir.be').replace(/\/$/, '')
const BASE = process.env.DOCS_BASE ?? '/'

/**
 * Google Analytics, in the built site only.
 *
 * `NODE_ENV` is `production` under `vitepress build` and `development` under
 * `vitepress dev`, so a local session never lands in the numbers — which
 * matters more than it sounds for a site this size, where one afternoon of
 * writing would otherwise outweigh a week of real visitors.
 *
 * The playground carries the same measurement id from its own entry point (see
 * packages/playground/src/analytics.ts): it is served as a page of this site
 * but built as a separate app, so it has its own `<head>` and needs its own
 * tag.
 */
const GA_ID = 'G-3MEVPBV06E'

const ANALYTICS: HeadConfig[] =
  process.env.NODE_ENV === 'production'
    ? [
        ['script', { async: '', src: `https://www.googletagmanager.com/gtag/js?id=${GA_ID}` }],
        [
          'script',
          {},
          `window.dataLayer = window.dataLayer || []
function gtag(){ dataLayer.push(arguments) }
gtag('js', new Date())
gtag('config', '${GA_ID}')`,
        ],
      ]
    : []

const DESCRIPTION =
  'A framework-agnostic org chart that renders 50,000 nodes at 60fps. Canvas in a Web Worker; your Vue, React or plain-DOM components mounted only where they can be read.'

/**
 * Serves the embedded playground's own `index.html` in DEV.
 *
 * Its assets are already served — they are ordinary files under `public/` —
 * but the HTML entry is not: VitePress's dev server answers any navigation
 * with its own SPA shell, which then finds no route for `/playground/` and
 * renders a 404. Production is unaffected, because there the file is copied
 * out verbatim and no SPA fallback stands in front of it.
 *
 * Registered before Vite's internal middlewares (a plain `use` inside
 * `configureServer`, not the returned post-hook) so it answers first, and
 * scoped to the one exact path so nothing else changes.
 */
function servePlaygroundInDev(base: string) {
  const indexPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'playground', 'index.html')
  const route = `${base}playground/`

  return {
    name: 'klad-playground-dev',
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use((req: { url?: string }, res: {
        setHeader: (k: string, v: string) => void
        end: (body?: string) => void
      }, next: () => void) => {
        const path = (req.url ?? '').split('?')[0]
        if (path !== route && path !== route.replace(/\/$/, '')) return next()
        try {
          res.setHeader('Content-Type', 'text/html')
          res.end(readFileSync(indexPath, 'utf8'))
        } catch {
          // Not built yet — say so plainly rather than showing a 404 that
          // suggests the route itself is wrong.
          res.setHeader('Content-Type', 'text/html')
          res.end('<p>The playground has not been built yet. Run <code>pnpm --filter @klad/docs build</code>, or start the docs with <code>pnpm docs</code>, which builds it first.</p>')
        }
      })
    },
  }
}

export default defineConfig({
  title: 'Klad',
  description: DESCRIPTION,
  base: BASE,
  cleanUrls: true,
  lastUpdated: true,

  // Emits sitemap.xml. A crawler would find the pages either way; what this
  // adds is the `lastmod` it uses to decide how often to come back.
  sitemap: { hostname: `${SITE_URL}${BASE}` },

  head: [
    ...ANALYTICS,
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#2563eb' }],

    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Klad' }],
    ['meta', { property: 'og:image', content: `${SITE_URL}${BASE}og.png` }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'Klad — 50,000 nodes. 60fps.' }],

    // `summary_large_image` is what makes the card render the image full
    // width rather than as a thumbnail beside the text.
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: `${SITE_URL}${BASE}og.png` }],
  ],

  /**
   * Per-page `og:title`/`og:description`/`og:url`, and a canonical link.
   *
   * The static `head` above cannot do this: it is identical on every page, so
   * every link shared from anywhere on the site would preview as the home
   * page. This runs per page and prefers the page's own frontmatter
   * description, falling back to the site's.
   */
  transformPageData(pageData) {
    // `pageData.title` is an empty string on a layout: home page, not
    // `undefined` — so `??` alone would leave the site's own name off the
    // card and preview it as " · Klad".
    const title = pageData.frontmatter.title || pageData.title || 'Klad'
    const description = pageData.frontmatter.description ?? DESCRIPTION
    const url = `${SITE_URL}${BASE}${pageData.relativePath.replace(/(index)?\.md$/, '')}`
    const ogTitle = title === 'Klad' ? 'Klad' : `${title} · Klad`

    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: ogTitle }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { name: 'twitter:title', content: ogTitle }],
      ['meta', { name: 'twitter:description', content: description }],
    )
  },

  vite: { plugins: [servePlaygroundInDev(BASE)] },

  markdown: {
    config(md) {
      md.use(tabsMarkdownPlugin)
    },
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/options' },
      // Root-relative WITHOUT the base: VitePress prefixes `base` onto any
      // nav link starting with `/`, so writing it in here produces
      // `/orgchart/orgchart/playground/`. `target` keeps it a plain
      // navigation — the playground is a separate Vite app copied in under
      // `public/`, not one of VitePress's own routes.
      { text: 'Playground', link: '/playground/', target: '_self' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'Licence', link: '/licence' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Node content', link: '/guide/node-content' },
            { text: 'Navigating', link: '/guide/navigating' },
            { text: 'Sizing', link: '/guide/sizing' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API',
          items: [
            { text: 'Options', link: '/api/options' },
            { text: 'Chart API', link: '/api/chart' },
            { text: 'Events', link: '/api/events' },
            { text: 'Theme', link: '/api/theme' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/n1crack/klad' }],

    footer: {
      message: 'AGPL-3.0-or-later, with a commercial licence available.',
      copyright: '© Yusuf Özdemir',
    },

    search: { provider: 'local' },
  },
})
