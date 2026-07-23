/**
 * A very small syntax highlighter for the Code panel's own output.
 *
 * Deliberately not Shiki or Prism: this colours one snippet, of one shape,
 * that this app generated itself a moment earlier — a real highlighter would
 * be a megabyte of grammar and a WASM regex engine to parse text we already
 * know the structure of. It handles what the generator can emit and nothing
 * else: comments, strings, template literals, numbers, keywords, JSX/HTML
 * tags, and object keys.
 *
 * It is a tokeniser rather than a series of `replace` passes over the whole
 * string, because the passes are what make hand-rolled highlighters wrong:
 * colour the keywords first and the next pass happily "finds" a keyword
 * inside the `<span>` the previous one just wrote. Scanning once, left to
 * right, means every character belongs to exactly one token.
 */
type Kind = 'comment' | 'string' | 'number' | 'keyword' | 'tag' | 'key' | 'plain'

const KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'const',
  'let',
  'function',
  'return',
  'type',
  'interface',
  'new',
  'await',
  'async',
  'true',
  'false',
  'null',
  'undefined',
  'script',
  'template',
  'setup',
  'lang',
])

const IDENT = /[A-Za-z_$][\w$]*/y

/** HTML-escapes `text`. Everything below writes through this. */
function escape(text: string): string {
  return text.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'))
}

function span(kind: Kind, text: string): string {
  return kind === 'plain' ? escape(text) : `<span class="tok-${kind}">${escape(text)}</span>`
}

/**
 * Highlights `source`, returning HTML for the inside of a `<code>` element.
 *
 * The only caller is the Code panel, and the only input is this app's own
 * generated snippet — but everything still goes through `escape`, because the
 * snippet carries values a viewer typed into a colour picker and one day will
 * carry something else, and "the input is trusted" is how injection happens.
 */
export function highlight(source: string): string {
  let out = ''
  let i = 0

  while (i < source.length) {
    const char = source[i]!
    const next = source[i + 1]

    // Line comment — the generator's own notes to the reader.
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      out += span('comment', source.slice(i, stop))
      i = stop
      continue
    }

    // A quoted string, or a template literal. No escape handling beyond `\\`
    // itself: the generator emits `\'` inside single quotes and nothing more
    // exotic, and a highlighter that mis-colours an unreachable case is a
    // better trade than one that carries a JS string grammar around.
    if (char === "'" || char === '"' || char === '`') {
      let j = i + 1
      while (j < source.length && source[j] !== char) {
        if (source[j] === '\\') j++
        j++
      }
      out += span('string', source.slice(i, Math.min(j + 1, source.length)))
      i = j + 1
      continue
    }

    // A JSX/HTML tag name, including a closing tag's slash: `<Klad`, `</div`.
    if (char === '<' && /[A-Za-z/]/.test(next ?? '')) {
      IDENT.lastIndex = next === '/' ? i + 2 : i + 1
      const match = IDENT.exec(source)
      if (match !== null) {
        out += span('tag', source.slice(i, IDENT.lastIndex))
        i = IDENT.lastIndex
        continue
      }
    }

    if (/\d/.test(char)) {
      let j = i
      while (j < source.length && /[\d.]/.test(source[j]!)) j++
      out += span('number', source.slice(i, j))
      i = j
      continue
    }

    if (/[A-Za-z_$]/.test(char)) {
      IDENT.lastIndex = i
      const match = IDENT.exec(source)!
      const word = match[0]
      // An identifier followed by a colon is an object key — which is most of
      // what these snippets are, so it earns its own colour rather than
      // sharing the plain one with everything else.
      const after = source.slice(IDENT.lastIndex).match(/^\s*:/)
      out += span(KEYWORDS.has(word) ? 'keyword' : after !== null ? 'key' : 'plain', word)
      i = IDENT.lastIndex
      continue
    }

    out += escape(char)
    i++
  }

  return out
}
