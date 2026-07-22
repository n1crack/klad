import { defineConfig } from 'vitepress'
import { tabsMarkdownPlugin } from 'vitepress-plugin-tabs'

/**
 * Where the site will actually live. Both are overridable from the
 * environment so deploying somewhere else — a project page under a subpath, a
 * custom domain — is a deploy-time decision rather than a commit:
 *
 *   DOCS_URL=https://orgchart.example DOCS_BASE=/ pnpm --filter ...-docs build
 *
 * `SITE_URL` matters beyond tidiness: `og:image` and `og:url` have to be
 * absolute, because the crawler fetching them has no page to resolve a
 * relative path against.
 */
// Origin only — the path comes from `BASE`, and putting it in both is how you
// get `/orgchart/orgchart/` in every canonical link.
const SITE_URL = (process.env.DOCS_URL ?? 'https://n1crack.github.io').replace(/\/$/, '')
const BASE = process.env.DOCS_BASE ?? '/orgchart/'

const DESCRIPTION =
  'A framework-agnostic org chart that renders 50,000 nodes at 60fps. Canvas in a Web Worker; your Vue, React or plain-DOM components mounted only where they can be read.'

export default defineConfig({
  title: 'OrgChart',
  description: DESCRIPTION,
  base: BASE,
  cleanUrls: true,
  lastUpdated: true,

  // Emits sitemap.xml. A crawler would find the pages either way; what this
  // adds is the `lastmod` it uses to decide how often to come back.
  sitemap: { hostname: `${SITE_URL}${BASE}` },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#2563eb' }],

    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'OrgChart' }],
    ['meta', { property: 'og:image', content: `${SITE_URL}${BASE}og.png` }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'OrgChart — 50,000 nodes. 60fps.' }],

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
    // card and preview it as " · OrgChart".
    const title = pageData.frontmatter.title || pageData.title || 'OrgChart'
    const description = pageData.frontmatter.description ?? DESCRIPTION
    const url = `${SITE_URL}${BASE}${pageData.relativePath.replace(/(index)?\.md$/, '')}`
    const ogTitle = title === 'OrgChart' ? 'OrgChart' : `${title} · OrgChart`

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

    socialLinks: [{ icon: 'github', link: 'https://github.com/n1crack/orgchart' }],

    footer: {
      message: 'AGPL-3.0-or-later, with a commercial licence available.',
      copyright: '© Yusuf Özdemir',
    },

    search: { provider: 'local' },
  },
})
