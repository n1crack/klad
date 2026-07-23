# Changesets

Adding a change to a release: `pnpm changeset`, answer the prompts, commit the
file it writes. Releasing is `pnpm version-packages` (applies every pending
changeset, bumps versions, rewrites changelogs) then `pnpm release` (builds,
then publishes).

Two settings here are deliberate:

- **`fixed`** keeps the four published packages on one version number. They are
  one library split across an engine and three bindings, and a consumer pairing
  `@klados/vue@1.2.0` with `klados@1.0.4` has to work out
  which combinations were ever tested together. One number means there is
  nothing to work out.
- **`ignore`** leaves the playground out: it is a private app, never published.
