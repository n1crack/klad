# Laravel Forge deploy script for klad.ozdemir.be.
#
# Paste this into Forge (Sites → klad.ozdemir.be → Deployments → Deploy
# Script). Kept here so the thing that builds the site is reviewable, and so a
# rebuilt server is a paste rather than an excavation.
#
# Not runnable as-is, and not meant to be: `$CREATE_RELEASE()` and
# `$ACTIVATE_RELEASE()` are Forge's own macros for its zero-downtime flow —
# make a release directory, and point `current` at it once everything between
# them succeeded. `bash -n` will object to them; Forge will not.
#
# The site is static: this builds it and Forge activates the release; nginx
# then only serves files (see nginx.conf). The site's **Web Directory** stays
# at Forge's own default, `/public` — the build writes into
# `packages/docs/.vitepress/dist` and the last step moves it there, which is
# one less Forge setting to remember and the same shape as every other site on
# the box.

$CREATE_RELEASE()

cd $FORGE_RELEASE_DIRECTORY

# Where the site will live. The same source builds for a subpath or another
# domain by changing these two — they are deploy-time facts, not config worth
# committing. Canonical links, og:url and the sitemap are all built from them.
export DOCS_BASE=/
export DOCS_URL=https://klad.ozdemir.be

# The repository's own `playwright` devDependency downloads a browser on
# install — 300MB the tests need and this server never will.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# pnpm, at the version the lockfile was written by (`packageManager` in the
# root manifest). corepack ships with Node and reads that field, so there is no
# version to keep in step here; the npm fallback covers a server whose corepack
# is disabled.
corepack enable pnpm 2>/dev/null || npm install -g pnpm@10.13.1

# Only the docs package and what it actually depends on — `...` means "and its
# workspace dependencies". That skips the root's own devDependencies
# (playwright, vitest, turbo, oxlint), none of which build a page.
pnpm install --frozen-lockfile --filter @klad/docs...

# Builds the embedded playground for this base path first, then the site
# around it (see packages/docs/scripts/bundle-playground.mjs). One origin, one
# deploy: the playground is a page of the docs, not a second host.
pnpm --filter @klad/docs build

# Where Forge expects to serve from. Moved rather than copied: the build
# output is the only thing this release needs to keep, and a copy would double
# it on disk for every release Forge retains.
rm -rf public
mv packages/docs/.vitepress/dist public

# Nothing else here is served, and a release directory carrying a node_modules
# tree per deploy fills a small disk quickly.
rm -rf node_modules packages/*/node_modules

$ACTIVATE_RELEASE()
