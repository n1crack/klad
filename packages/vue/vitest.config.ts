import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

// No Vue plugin: there are no Single File Components here any more, and the
// tests mount the component with `h()` rather than a template.
export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
})
