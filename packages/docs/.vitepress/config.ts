import { defineConfig } from 'vitepress'
import { tabsMarkdownPlugin } from 'vitepress-plugin-tabs'

export default defineConfig({
  title: 'OrgChart',
  description:
    'A framework-agnostic org chart that renders 50,000 nodes at 60fps — canvas in a worker, real components only where you can read them.',
  cleanUrls: true,
  lastUpdated: true,

  markdown: {
    config(md) {
      md.use(tabsMarkdownPlugin)
    },
  },

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/options' },
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
