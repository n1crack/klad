/**
 * Google Analytics, loaded only in a built app.
 *
 * The playground is a page OF the documentation site but a separate Vite
 * build with its own `<head>` (see packages/docs/scripts/bundle-playground.mjs),
 * so it carries the same measurement id as the site rather than inheriting a
 * tag from it.
 *
 * Injected from script rather than written into `index.html` so it can be
 * conditional: `import.meta.env.PROD` is false under `pnpm dev`, and an
 * afternoon of development would otherwise outweigh a week of real visitors in
 * the numbers for a page this small.
 */
const GA_ID = 'G-3MEVPBV06E'

export function startAnalytics(): void {
  if (!import.meta.env.PROD) return

  const loader = document.createElement('script')
  loader.async = true
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.append(loader)

  // The queue is what `gtag` writes to, and it has to exist before the tag
  // above finishes loading — the whole point of the shim is that calls made
  // in the meantime are not lost.
  const w = window as typeof window & { dataLayer?: unknown[] }
  w.dataLayer = w.dataLayer ?? []
  const gtag = (...args: unknown[]): void => {
    w.dataLayer!.push(args)
  }
  gtag('js', new Date())
  gtag('config', GA_ID)
}
