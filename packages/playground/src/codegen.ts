import { highlightWidthFor, minimapOptionFor, themeFor, type Example, type MinimapPosition } from './data.js'
import type { ThemeMode } from './theme.js'

/**
 * Turns whatever the playground is currently showing into the code that would
 * produce it, for any of the three stacks.
 *
 * The point of the playground is that you can dial a chart in by hand; the
 * point of this is that you do not then have to translate what you dialled
 * back into options by reading a sidebar. So the snapshot is taken from the
 * live controls (see `snapshot()` in main.ts), not from the example's declared
 * options — an edge radius dragged to 12 shows up as `edgeCornerRadius: 12`.
 *
 * What it deliberately does NOT emit is the node content: the cards are your
 * own DOM/JSX/template and each stack expresses them differently, so the
 * snippet marks where they go and leaves them to you. Everything above that
 * line is copy-pasteable as-is.
 */
export type Stack = 'vanilla' | 'vue' | 'react'

export interface ConfigSnapshot {
  example: Example
  mode: ThemeMode
  minimapOn: boolean
  minimapPosition: MinimapPosition
  edgeRadius: number
  edgeWidth: number
  nodeFill: string
  /** `'transparent'` when the "Shape fill" checkbox is off — see main.ts. */
  blockFill: string
  accent: string
  ringEnabled: boolean
  /** Whether the example renders node content at all (`content: 'none'` does not). */
  hasNodeContent: boolean
}

/** The `theme` object the snapshot's controls add up to. */
function themeOf(snapshot: ConfigSnapshot): Record<string, unknown> {
  return {
    ...themeFor(snapshot.example, snapshot.edgeRadius, snapshot.mode),
    nodeFill: snapshot.nodeFill,
    blockFill: snapshot.blockFill,
    edgeWidth: snapshot.edgeWidth,
    edgeHighlightWidth: highlightWidthFor(snapshot.edgeWidth),
    ringStroke: snapshot.accent,
    edgeHighlightStroke: snapshot.accent,
    highlightStroke: snapshot.accent,
  }
}

/**
 * The options to print, in a deliberate order: what the chart IS (data, node
 * size, label), then how it is laid out, then how it looks. Alphabetical would
 * scatter `orientation` and `rtl` apart and bury `data` in the middle.
 *
 * `ring` is only printed when it is off, `minimap` only when it is on: a
 * snippet restating every default is a worse answer than a short one, and
 * these two are the controls whose default is the common case.
 */
function optionsOf(snapshot: ConfigSnapshot): [key: string, value: unknown][] {
  const example = snapshot.example
  const declared = example.options as Record<string, unknown>
  const entries: [string, unknown][] = [['data', RAW('data')]]

  for (const key of ['nodeSize', 'label', 'orientation', 'rtl', 'collapsedByDefault', 'toggleOnNodeClick']) {
    if (declared[key] !== undefined) entries.push([key, declared[key]])
  }
  if (declared.nodeSize === undefined) entries.push(['nodeSize', { w: 180, h: 64 }])
  if (declared.label === undefined) entries.push(['label', RAW("(item) => String(item.name ?? '')")])

  if (snapshot.minimapOn) {
    entries.push([
      'minimap',
      minimapOptionFor(example, true, snapshot.minimapPosition, snapshot.mode),
    ])
  }
  if (!snapshot.ringEnabled) entries.push(['ring', false])
  entries.push(['theme', themeOf(snapshot)])
  return entries
}

/**
 * A value to print verbatim rather than serialise — a function, or a reference
 * to something the reader is expected to supply (`data`). Marked with a class
 * rather than a magic string prefix so nothing a real option could contain can
 * be mistaken for one.
 */
class Raw {
  constructor(readonly source: string) {}
}
function RAW(source: string): Raw {
  return new Raw(source)
}

/**
 * `JSON.stringify` with JS object syntax rather than JSON's: unquoted keys
 * where they are identifiers, single quotes, trailing-comma-free, and
 * functions printed as their own source rather than dropped (which is what
 * `JSON.stringify` does to them — silently, and it is exactly the interesting
 * part of `nodeSize: (item) => ...`).
 */
function print(value: unknown, indent: string): string {
  if (value instanceof Raw) return value.source
  if (typeof value === 'function') return printFunction(value as (...args: unknown[]) => unknown, indent)
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const inner = indent + '  '
    return `[\n${value.map((item) => `${inner}${print(item, inner)},`).join('\n')}\n${indent}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    // Short objects on one line: `{ w: 180, h: 64 }` is a size, not a
    // structure, and stacking it over four lines makes it read as one.
    const oneLine = `{ ${entries.map(([k, v]) => `${key(k)}: ${print(v, indent)}`).join(', ')} }`
    if (oneLine.length + indent.length <= 72 && !oneLine.includes('\n')) return oneLine
    const inner = indent + '  '
    return `{\n${entries.map(([k, v]) => `${inner}${key(k)}: ${print(v, inner)},`).join('\n')}\n${indent}}`
  }
  return String(value)
}

function key(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`
}

/**
 * A function's own source, re-indented to where it is being printed.
 *
 * The source is whatever the bundler left behind — readable in dev, minified
 * in a production build — but it is always VALID, which is what matters for
 * something the reader is going to paste. The alternative (a `/* your function
 * here *\/` placeholder) would drop the most interesting option an example
 * has: the variable-node-size example IS its `nodeSize` function.
 */
function printFunction(fn: (...args: unknown[]) => unknown, indent: string): string {
  const source = fn.toString().trim()
  const lines = source.split('\n')
  if (lines.length === 1) return source
  const base = lines
    .slice(1)
    .filter((line) => line.trim() !== '')
    .reduce((min, line) => Math.min(min, line.length - line.trimStart().length), Number.POSITIVE_INFINITY)
  const strip = Number.isFinite(base) ? base : 0
  return lines
    .map((line, i) => (i === 0 ? line : indent + line.slice(strip)))
    .join('\n')
}

/**
 * `key: value` lines for the options object, at `indent`. `data` prints as the
 * shorthand `data,` — `data: data` is what a generator writes, not what a
 * person would.
 */
function optionLines(snapshot: ConfigSnapshot, indent: string): string {
  return optionsOf(snapshot)
    .map(([name, value]) =>
      value instanceof Raw && value.source === name
        ? `${indent}${name},`
        : `${indent}${name}: ${print(value, indent)},`,
    )
    .join('\n')
}

/**
 * A one-line note about the two things the snippet cannot carry: the data
 * itself, and the node content. Both are the reader's own, and saying so in
 * the code beats a snippet that looks complete and then renders nothing.
 */
const DATA_NOTE = "// `data` is your own array of { id, parentId?, ... }."

function nodeContentNote(hasNodeContent: boolean): string {
  return hasNodeContent
    ? '// The card itself is your own markup — this is everything else.'
    : '// No node content: the chart is pure canvas, which is this example.'
}

function vanilla(snapshot: ConfigSnapshot): string {
  const content = snapshot.hasNodeContent
    ? `\n  renderNode: (element, context) => {\n    element.textContent = String(context.item.name ?? '')\n  },`
    : ''
  return `import { createOrgChart } from '@n1crack/orgchart'

${DATA_NOTE}
${nodeContentNote(snapshot.hasNodeContent)}

const chart = createOrgChart(host, {
${optionLines(snapshot, '  ')}${content}
})
`
}

function vue(snapshot: ConfigSnapshot): string {
  const slot = snapshot.hasNodeContent
    ? `
    <template #node="{ item }">
      <div class="card">{{ item.name }}</div>
    </template>`
    : ''
  return `<script setup lang="ts">
import { OrgChart, type Options } from '@n1crack/orgchart-vue'

${DATA_NOTE}
${nodeContentNote(snapshot.hasNodeContent)}

const options: Options = {
${optionLines(snapshot, '  ')}
}
</script>

<template>
  <OrgChart :options="options">${slot}
  </OrgChart>
</template>
`
}

function react(snapshot: ConfigSnapshot): string {
  const children = snapshot.hasNodeContent
    ? `>
      {(context) => <div className="card">{String(context.item.name ?? '')}</div>}
    </OrgChart>`
    : ' />'
  return `import { useMemo } from 'react'
import { OrgChart, type Options } from '@n1crack/orgchart-react'

${DATA_NOTE}
${nodeContentNote(snapshot.hasNodeContent)}

export function Chart() {
  const options = useMemo<Options>(
    () => ({
${optionLines(snapshot, '      ')}
    }),
    [],
  )

  return (
    <OrgChart options={options}${children}
  )
}
`
}

const GENERATORS: Record<Stack, (snapshot: ConfigSnapshot) => string> = { vanilla, react, vue }

/** The code for `stack` that reproduces `snapshot`. */
export function generateCode(stack: Stack, snapshot: ConfigSnapshot): string {
  return GENERATORS[stack](snapshot)
}
