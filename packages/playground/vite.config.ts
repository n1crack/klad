import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import react from '@vitejs/plugin-react'

/**
 * `base` is set from the environment because this app is built twice: on its
 * own at the site root, and again into the documentation site under
 * `<docs base>/playground/`. Every asset URL Vite emits is prefixed with it,
 * so getting it from the build that consumes the output — rather than pinning
 * it here — is what lets the same source serve both.
 */
export default defineConfig({
  base: process.env.PLAYGROUND_BASE ?? '/',
  plugins: [vue(), react()],
})
