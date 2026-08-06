import DefaultTheme from 'vitepress/theme'
import { enhanceAppWithTabs } from 'vitepress-plugin-tabs/client'
import type { Theme } from 'vitepress'
import './custom.css'

// Annotated rather than left to inference so that `enhanceApp`'s context is
// typed: without it `app` is an implicit `any` and nothing checks that it is
// the thing `enhanceAppWithTabs` wants.
const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    enhanceAppWithTabs(app)
  },
}

export default theme
