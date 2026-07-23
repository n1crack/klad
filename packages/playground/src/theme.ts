import type { Options } from '@n1crack/orgchart'

/**
 * Light/dark for the whole playground — the shell's chrome AND the chart's own
 * canvas tokens, kept in one place because they are one look, not two.
 *
 * The chart draws its nodes on a `<canvas>` while the demo cards that sit over
 * them are DOM. Those two paint the same box: the canvas fills `theme.nodeFill`
 * behind a card whose own CSS background covers it. That only LOOKS like one
 * surface while the two colours agree — otherwise the canvas's fill shows
 * around the card's edges, most visibly at the corners where the two rounded
 * rectangles part company. Before this module, the card's background was a
 * `color-mix` off the system `canvas` colour while the canvas painted the
 * library's default `#ffffff`: they disagreed slightly in light mode (a pale
 * halo at each corner) and completely in dark mode (a white box behind every
 * dark card). So both sides now read the SAME tokens from here — CSS custom
 * properties for the cards, `api.setTheme` for the canvas — and the corner
 * radius is one number shared the same way (see `--node-radius`/`cornerRadius`
 * below), since a canvas box rounded to 6 behind a card rounded to 8 leaks
 * exactly the same way a mismatched colour does.
 */
export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'orgchart-playground-theme'

/**
 * VitePress's own appearance key. This app is served BOTH on its own and as a
 * page of the documentation site (`<docs base>/playground/`, a plain
 * navigation rather than an iframe — see packages/docs/.vitepress/config.ts),
 * and the two are the same origin, so the docs' own light/dark choice is
 * readable here. A visitor who set the docs to dark and then clicked
 * "Playground" should not be handed a white page.
 *
 * Read only as a FALLBACK, below this app's own key, and only for an explicit
 * `'light'`/`'dark'` — VitePress writes `'auto'` for "follow the OS", which is
 * what `systemMode()` already does.
 */
const DOCS_STORAGE_KEY = 'vitepress-theme-appearance'

/**
 * The chart-side tokens per mode: what the canvas paints. Only the tokens that
 * actually carry the light/dark look are listed — an example's own theme
 * (Avatar circle's transparent node box, say) still wins over these, and the
 * playground's own colour controls still override them live afterwards.
 *
 * `nodeFill`/`nodeStroke` are deliberately the SAME values the cards use for
 * `background`/`border-color` (see `SHELL_TOKENS`), not merely similar ones.
 */
const CHART_TOKENS: Record<ThemeMode, NonNullable<Options['theme']>> = {
  light: {
    nodeFill: '#ffffff',
    nodeStroke: '#d8dce3',
    cornerRadius: 8,
    edgeStroke: '#cbd2dc',
    labelColour: '#18181b',
    highlightFill: '#fef3c7',
  },
  dark: {
    nodeFill: '#1b2029',
    nodeStroke: '#333c4b',
    cornerRadius: 8,
    edgeStroke: '#3a4453',
    labelColour: '#e7eaf0',
    // The light mode's amber-100 would glare on a dark chart; this is the same
    // hue at the other end of its ramp, so a lit node still reads as "the one
    // you asked for" against its neighbours without becoming the brightest
    // thing on the page.
    highlightFill: '#4a3a12',
  },
}

/**
 * The shell-side half of the same palette, written onto `:root` as custom
 * properties for style.css to consume. Everything else in the stylesheet is
 * built on the `canvas`/`canvastext` system colours, which flip on their own
 * once `color-scheme` is set (see `applyTheme`) — these are only the tokens
 * that must match the canvas EXACTLY rather than merely suit the mode.
 */
const SHELL_TOKENS: Record<ThemeMode, Record<string, string>> = {
  light: {
    '--node-bg': CHART_TOKENS.light.nodeFill!,
    '--node-border': CHART_TOKENS.light.nodeStroke!,
    '--node-radius': `${CHART_TOKENS.light.cornerRadius!}px`,
    '--accent': '#2563eb',
    '--accent-contrast': '#ffffff',
    '--shadow-sm': '0 1px 2px rgba(15, 23, 42, 0.12)',
    '--node-shadow': '0 1px 3px rgba(15, 23, 42, 0.14)',
  },
  dark: {
    '--node-bg': CHART_TOKENS.dark.nodeFill!,
    '--node-border': CHART_TOKENS.dark.nodeStroke!,
    '--node-radius': `${CHART_TOKENS.dark.cornerRadius!}px`,
    // blue-600 reads dim on a dark surface; blue-400 keeps the same role
    // (links, focus rings, the export buttons, a pressed toggle) readable.
    '--accent': '#60a5fa',
    '--accent-contrast': '#0b1220',
    // Shadows are the one token that cannot simply be derived from the text
    // colour the way the rest of the shell's palette is: `canvastext` is WHITE
    // in dark mode, so a shadow mixed from it stops being a shadow and becomes
    // a halo around every card. Both modes cast a dark shadow; the dark one is
    // simply deeper, because it has less contrast to work with.
    '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.5)',
    '--node-shadow': '0 1px 3px rgba(0, 0, 0, 0.55)',
  },
}

/**
 * The minimap silhouette's fill per mode. The widget's plate and border are
 * DOM and follow the shell's own CSS (see `.orgchart-minimap` in style.css);
 * the silhouette is pixels, so it can only follow the theme through the
 * library's own `minimap.silhouetteColour` option. The default slate is
 * legible on a light plate and all but invisible on a dark one, which is the
 * whole reason this is here.
 */
const SILHOUETTE_COLOUR: Record<ThemeMode, string> = {
  light: '#475569',
  dark: '#94a3b8',
}

/** The minimap silhouette colour for `mode` — see `SILHOUETTE_COLOUR`. */
export function silhouetteColour(mode: ThemeMode): string {
  return SILHOUETTE_COLOUR[mode]
}

/** The canvas tokens for `mode` — see `CHART_TOKENS`. */
export function chartTokens(mode: ThemeMode): NonNullable<Options['theme']> {
  return CHART_TOKENS[mode]
}

/**
 * The stored preference, or `null` when the viewer has never chosen — which is
 * not the same as "light": with no stored choice the playground follows the OS
 * and keeps following it (see `watchSystemTheme`), and only a real click on the
 * toggle pins it.
 */
function storedMode(): ThemeMode | null {
  return readMode(STORAGE_KEY)
}

/** The mode stored under `key`, or `null` for anything that is not one. */
function readMode(key: string): ThemeMode | null {
  try {
    const value = localStorage.getItem(key)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    // Private-mode Safari and friends throw on `localStorage` access rather
    // than returning null. A playground that cannot remember a preference is
    // fine; one that fails to start because it cannot is not.
    return null
  }
}

function systemMode(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * The mode to start in: this app's own stored choice, else the documentation
 * site's (see `DOCS_STORAGE_KEY`), else the OS preference.
 */
export function initialMode(): ThemeMode {
  return storedMode() ?? readMode(DOCS_STORAGE_KEY) ?? systemMode()
}

/** Remembers `mode` as an explicit choice, so the OS no longer decides. */
export function rememberMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // See `storedMode` — a preference that cannot be persisted still applies
    // for this session.
  }
}

/**
 * Calls `onChange` when the OS preference flips, but only while the viewer has
 * made no explicit choice of their own — once they have, the OS is not allowed
 * to overrule it behind their back.
 */
export function watchSystemTheme(onChange: (mode: ThemeMode) => void): void {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    if (storedMode() !== null) return
    onChange(event.matches ? 'dark' : 'light')
  })
}

/**
 * Puts `mode` on the document: `color-scheme` (which is what makes the
 * `canvas`/`canvastext` system colours the stylesheet is built on resolve
 * light or dark, form controls and scrollbars included — the whole reason the
 * shell needs almost no per-mode CSS of its own), a `data-theme` attribute for
 * the few rules that must key off the explicit choice rather than the OS
 * preference, and the shared node tokens above.
 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  root.dataset.theme = mode
  root.style.colorScheme = mode
  for (const [name, value] of Object.entries(SHELL_TOKENS[mode])) {
    root.style.setProperty(name, value)
  }
}
