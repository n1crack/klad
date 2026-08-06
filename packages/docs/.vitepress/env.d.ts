/**
 * Vite resolves a CSS side-effect import at build time and hands TypeScript
 * nothing to go on; without this the theme entry does not type-check. Normally
 * `vite/client` supplies this, but Vite is a transitive dependency of
 * VitePress here rather than a direct one, so it does not resolve from this
 * package.
 */
declare module '*.css'
