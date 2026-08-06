/**
 * There was no prettier config until now, and `pnpm format` has evidently
 * never been run: prettier's defaults are double quotes and semicolons, this
 * codebase is single quotes and none, so the first person to run the script
 * reformatted 133 files into a style the repository does not use. A `format`
 * script with no config is not a convenience, it is a trap — and the trap only
 * springs on whoever tries to use it.
 *
 * These settings were measured rather than chosen. Checking the tree at the
 * time against every plausible combination, this one left the fewest files
 * disagreeing; `printWidth` 108 and 110 tied, and 110 is the rounder number.
 * `trailingComma: 'all'` and `arrowParens: 'always'` are prettier's own
 * defaults and also what the code already did, so they are here to be explicit
 * rather than to change anything.
 *
 * Nothing above makes the code prettier-clean on its own — no setting did,
 * because the style was maintained by hand and by editors rather than by this
 * tool. The commit that adds this file reformats the rest, and `format:check`
 * in CI is what keeps it from drifting back.
 */
export default {
  semi: false,
  singleQuote: true,
  printWidth: 110,
  trailingComma: 'all',
  arrowParens: 'always',
}
